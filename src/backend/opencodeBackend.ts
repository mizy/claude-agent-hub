/**
 * OpenCode CLI 后端适配器 (v1.x)
 *
 * 非交互模式: opencode run "prompt" -m provider/model --format json
 * 完整支持 Claude Code 同等功能：MCP 配置、费用追踪、图片提取、权限控制
 */

import { execa, type ResultPromise } from 'execa'
import chalk from 'chalk'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import { toInvokeError } from '../shared/toInvokeError.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'
import { parseClaudeCompatOutput } from './parseClaudeCompatOutput.js'
import { collectStderr, probeCliVersion } from './processHelpers.js'
import { stripAnsi } from '../shared/logger.js'
import { collectStream } from './collectStream.js'
import { createClaudeCompatStreamProcessor } from './claudeCompatHelpers.js'
import { logCliCommand, buildRedactedCommand } from '../store/conversationLog.js'

const logger = createLogger('opencode')

export function createOpencodeBackend(): BackendAdapter {
  return {
    name: 'opencode',
    displayName: 'OpenCode',
    cliBinary: 'opencode',

    capabilities: {
      supportsStreaming: true,
      supportsSessionReuse: true,
      supportsCostTracking: true,
      supportsMcpConfig: true,
      supportsAgentTeams: true,
    },

    async invoke(options: InvokeOptions): Promise<Result<InvokeResult, InvokeError>> {
      const {
        prompt,
        cwd = process.cwd(),
        stream = false,
        timeoutMs = 30 * 60 * 1000,
        onChunk,
        model,
        sessionId,
        attachments,
        variant,
        signal,
      } = options

      const args = buildOpencodeArgs({
        prompt,
        cwd,
        model,
        sessionId,
        attachments,
        variant,
      })
      const startTime = Date.now()
      const perf = { spawn: 0, firstStdout: 0, firstDelta: 0 }

      logCliCommand({
        backend: 'opencode',
        command: buildRedactedCommand('opencode', args, prompt),
        prompt,
        sessionId,
        model,
        cwd,
      })

      try {
        const subprocess = execa('opencode', args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: stream ? { stdout: false, stderr: true } : true,
          env: {
            ...process.env,
            OPENCODE_PERMISSION: JSON.stringify({
              bash: 'allow',
              edit: 'allow',
              read: 'allow',
            }),
          },
          ...(signal ? { cancelSignal: signal, gracefulCancel: true } : {}),
        })
        perf.spawn = Date.now() - startTime

        let rawOutput: string
        let stderrOutput = ''
        let mcpImagePaths: string[] = []
        if (stream && subprocess.stdout) {
          collectStderr(subprocess, s => {
            stderrOutput = s
          })
          const streamResult = await streamOutput(subprocess, onChunk, startTime, perf)
          rawOutput = streamResult.rawOutput
          mcpImagePaths = streamResult.extractedImagePaths
        } else {
          const result = await subprocess
          rawOutput = result.stdout
          stderrOutput = result.stderr ?? ''
        }

        const durationMs = Date.now() - startTime
        logger.debug(
          `[perf] spawn: ${perf.spawn}ms, first-stdout: ${perf.firstStdout}ms, first-delta: ${perf.firstDelta}ms, total: ${durationMs}ms`
        )
        logger.debug(`rawOutput length: ${rawOutput.length}, first 200 chars: ${rawOutput.slice(0, 200)}`)
        const parsed = parseClaudeCompatOutput(rawOutput)
        logger.debug(`parsed response length: ${parsed.response.length}, sessionId: ${parsed.sessionId ? '***' : 'none'}`)

        // opencode error event (e.g. SSL cert failure, API error)
        if (parsed.error && !parsed.response) {
          logger.warn(`opencode error event: ${parsed.error}`)
          return err({ type: 'process', message: parsed.error })
        }

        if (!parsed.response && stderrOutput) {
          const cleanStderr = stripAnsi(stderrOutput)
          const stderrParsed = parseClaudeCompatOutput(cleanStderr)
          if (stderrParsed.response) {
            logger.warn(
              `opencode returned error via stderr: ${stderrParsed.response.slice(0, 200)}`
            )
            return err({ type: 'process', message: stderrParsed.response })
          }
        }

        // Empty response guard: opencode may run tool_use (e.g. image read) but return no assistant text
        if (!parsed.response && !parsed.error) {
          const rawSnippet = rawOutput.slice(0, 500)
          logger.warn(`opencode returned empty response. Raw output: ${rawSnippet}`)
          return err({
            type: 'process',
            message: `OpenCode returned empty response (${durationMs}ms). Raw: ${rawSnippet.slice(0, 200)}`,
          })
        }

        if (mcpImagePaths.length > 0) {
          logger.debug(
            `Extracted ${mcpImagePaths.length} MCP image(s): ${mcpImagePaths.join(', ')}`
          )
        }

        logger.info(
          `完成 (${(durationMs / 1000).toFixed(1)}s` +
            `${parsed.durationApiMs ? `, API: ${(parsed.durationApiMs / 1000).toFixed(1)}s` : ''})`
        )

        return ok({
          prompt,
          response: parsed.response,
          durationMs,
          sessionId: parsed.sessionId,
          durationApiMs: parsed.durationApiMs,
          costUsd: parsed.costUsd,
          promptTokens: parsed.promptTokens,
          completionTokens: parsed.completionTokens,
          totalTokens: parsed.totalTokens,
          benchmark: {
            spawnMs: perf.spawn,
            firstStdoutMs: perf.firstStdout || undefined,
            firstChunkMs: perf.firstDelta || undefined,
          },
          mcpImagePaths: mcpImagePaths.length > 0 ? mcpImagePaths : undefined,
        })
      } catch (error: unknown) {
        if (signal?.aborted) {
          return err({ type: 'cancelled', message: 'Chat interrupted by new message' })
        }
        return err(toInvokeError(error, 'OpenCode'))
      }
    },

    async checkAvailable(): Promise<boolean> {
      const version = await probeCliVersion('opencode')
      if (!version) {
        logger.debug('opencode not available or version not detectable')
        return false
      }
      logger.debug(`opencode version: ${version}`)
      return true
    },
  }
}

// ============ Private Helpers ============

interface BuildOpencodeArgsOptions {
  prompt: string
  cwd: string
  model?: string
  sessionId?: string
  attachments?: string[]
  variant?: string
}

function buildOpencodeArgs(options: BuildOpencodeArgsOptions): string[] {
  const { prompt, cwd, model, sessionId, attachments, variant } = options
  const args: string[] = ['run']

  if (sessionId) {
    args.push('--session', sessionId)
  }

  if (model) {
    // 支持 "opencode/glm-4.7-free" 或直接 "glm-4.7-free" 格式
    args.push('-m', model.includes('/') ? model : `opencode/${model}`)
  }

  // --variant requires opencode v1.3+
  if (variant) {
    args.push('--variant', variant)
  }

  // -f (file attachment) requires opencode v1.2+
  for (const file of attachments ?? []) {
    args.push('-f', file)
  }

  // Keep CLI execution directory explicit for remote/server-attach scenarios.
  args.push('--dir', cwd)
  args.push('--format', 'json')

  // opencode v1.2.15+: prompt must come after -- separator
  args.push('--', prompt)

  return args
}

async function streamOutput(
  subprocess: ResultPromise,
  onChunk?: (chunk: string) => void,
  startTime?: number,
  perf?: { spawn: number; firstStdout: number; firstDelta: number }
): Promise<{ rawOutput: string; extractedImagePaths: string[] }> {
  const extractedImagePaths: string[] = []
  const mcpToolUseIds = new Set<string>()

  const processLine = createClaudeCompatStreamProcessor({
    mcpToolUseIds,
    extractedImagePaths,
    perf,
    startTime,
    fallbackWrite: (text) => process.stdout.write(chalk.dim(text)),
  })

  const rawOutput = await collectStream(subprocess, {
    onChunk,
    perf,
    startTime,
    processLine,
  })

  return { rawOutput, extractedImagePaths }
}
