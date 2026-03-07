/**
 * Claude Code CLI 后端适配器
 *
 * 将 Claude Code CLI 封装为 BackendAdapter 实现
 */

import { execa, type ResultPromise } from 'execa'
import chalk from 'chalk'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import { toInvokeError } from '../shared/toInvokeError.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'
import { parseClaudeCompatOutput } from './parseClaudeCompatOutput.js'
import { collectStream } from './collectStream.js'
import { buildMcpConfigJson, createClaudeCompatStreamProcessor } from './claudeCompatHelpers.js'
import { collectStderr, probeCliVersion } from './processHelpers.js'
import { logCliCommand, buildRedactedCommand } from '../store/conversationLog.js'

const logger = createLogger('claude-code')

// ============ Backend Adapter ============

export function createClaudeCodeBackend(): BackendAdapter {
  return {
    name: 'claude-code',
    displayName: 'Claude Code',
    cliBinary: 'claude',

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
        skipPermissions = true,
        timeoutMs = 30 * 60 * 1000,
        onChunk,
        disableMcp = false,
        mcpServers,
        sessionId,
        model = 'opus',
        attachments,
        variant,
        signal,
      } = options

      const args = buildArgs({
        prompt,
        skipPermissions,
        disableMcp,
        mcpServers,
        sessionId,
        stream,
        model,
        attachments,
        variant,
      })
      const startTime = Date.now()
      const perf = { spawn: 0, firstStdout: 0, firstDelta: 0 }

      logCliCommand({
        backend: 'claude-code',
        command: buildRedactedCommand('claude', args, prompt),
        prompt,
        sessionId,
        model,
        cwd,
      })

      try {
        // Remove CLAUDECODE env var to allow nested claude CLI calls
        const env = { ...process.env }
        delete env.CLAUDECODE

        const subprocess = execa('claude', args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: stream ? { stdout: false, stderr: true } : true,
          env,
          ...(signal ? { cancelSignal: signal, gracefulCancel: true } : {}),
        })
        perf.spawn = Date.now() - startTime

        let rawOutput: string
        let mcpImagePaths: string[] = []
        if (stream) {
          collectStderr(subprocess, () => {})
          const streamResult = await streamOutput(subprocess, onChunk, startTime, perf)
          rawOutput = streamResult.rawOutput
          mcpImagePaths = streamResult.extractedImagePaths
        } else {
          const result = await subprocess
          rawOutput = result.stdout
        }

        const durationMs = Date.now() - startTime
        logger.debug(
          `[perf] spawn: ${perf.spawn}ms, first-stdout: ${perf.firstStdout}ms, first-delta: ${perf.firstDelta}ms, total: ${durationMs}ms`
        )
        const parsed = parseClaudeCompatOutput(rawOutput)

        if (mcpImagePaths.length > 0) {
          logger.debug(`Extracted ${mcpImagePaths.length} MCP image(s): ${mcpImagePaths.join(', ')}`)
        }

        logger.info(
          `完成 (${(durationMs / 1000).toFixed(1)}s, API: ${((parsed.durationApiMs ?? 0) / 1000).toFixed(1)}s)`
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
        return err(toInvokeError(error, 'Claude Code'))
      }
    },

    async checkAvailable(): Promise<boolean> {
      const env = { ...process.env }
      delete env.CLAUDECODE
      const version = await probeCliVersion('claude', { env })
      if (!version) {
        logger.debug('claude not available or version not detectable')
        return false
      }
      logger.debug(`claude version: ${version}`)
      return true
    },
  }
}

// ============ Private Helpers ============

interface ClaudeBuildArgsOptions {
  prompt: string
  skipPermissions: boolean
  disableMcp: boolean
  mcpServers?: string[]
  sessionId?: string
  stream?: boolean
  model?: string
  attachments?: string[]
  variant?: string
}

function buildArgs(options: ClaudeBuildArgsOptions): string[] {
  const {
    prompt,
    skipPermissions,
    disableMcp,
    mcpServers,
    sessionId,
    stream,
    model,
    attachments,
    variant,
  } = options

  const args: string[] = []

  if (sessionId) {
    args.push('--resume', sessionId)
  }

  if (model) {
    args.push('--model', model)
  }

  if (variant) {
    args.push('--effort', normalizeClaudeEffort(variant))
  }

  args.push('--print')

  if (stream) {
    args.push('--output-format', 'stream-json')
    args.push('--verbose')
    args.push('--include-partial-messages')
  } else {
    args.push('--output-format', 'json')
  }

  if (skipPermissions) {
    args.push('--dangerously-skip-permissions')
  }

  // MCP control: selective enable via --strict-mcp-config + --mcp-config
  if (disableMcp) {
    args.push('--strict-mcp-config')
    if (mcpServers?.length) {
      const mcpConfig = buildMcpConfigJson(mcpServers)
      if (mcpConfig) args.push('--mcp-config', mcpConfig)
    }
  }

  const fileSpecs = (attachments ?? []).filter(isClaudeFileSpec)
  if (fileSpecs.length > 0) {
    args.push('--file', ...fileSpecs)
  }

  args.push(prompt)
  return args
}

function isClaudeFileSpec(value: string): boolean {
  // Claude CLI expects --file in file_id:relative_path format, not local absolute paths.
  return value.includes(':')
}

function normalizeClaudeEffort(variant: string): 'low' | 'medium' | 'high' {
  const normalized = variant.trim().toLowerCase()
  if (normalized === 'minimal' || normalized === 'low') return 'low'
  if (normalized === 'max' || normalized === 'high') return 'high'
  return 'medium'
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
