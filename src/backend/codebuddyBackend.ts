/**
 * CodeBuddy CLI 后端适配器
 *
 * 腾讯 AI 编程助手，CLI 接口与 Claude Code 完全兼容
 * 非交互模式: codebuddy -p "prompt" --output-format stream-json --dangerously-skip-permissions
 * 别名: cbc
 */

import { execa, type ResultPromise } from 'execa'
import chalk from 'chalk'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import { toInvokeError } from '../shared/toInvokeError.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'
import { parseClaudeCompatOutput } from './parseClaudeCompatOutput.js'
import { collectStream } from './collectStream.js'
import { buildMcpConfigJson, createClaudeCompatStreamProcessor } from './claudeCompatHelpers.js'

const logger = createLogger('codebuddy')

export function createCodebuddyBackend(): BackendAdapter {
  return {
    name: 'codebuddy',
    displayName: 'CodeBuddy',
    cliBinary: 'codebuddy',

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
        model,
        signal,
      } = options

      const args = buildArgs(prompt, skipPermissions, disableMcp, mcpServers, sessionId, stream, model)
      const startTime = Date.now()
      const perf = { spawn: 0, firstStdout: 0, firstDelta: 0 }
      const binary = await resolveBinary()

      try {
        const subprocess = execa(binary, args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: stream ? { stdout: false, stderr: true } : true,
          ...(signal ? { cancelSignal: signal, gracefulCancel: true } : {}),
        })
        perf.spawn = Date.now() - startTime

        let rawOutput: string
        let mcpImagePaths: string[] = []
        if (stream) {
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
          mcpImagePaths: mcpImagePaths.length > 0 ? mcpImagePaths : undefined,
        })
      } catch (error: unknown) {
        if (signal?.aborted) {
          return err({ type: 'cancelled', message: 'Chat interrupted by new message' })
        }
        return err(toInvokeError(error, 'CodeBuddy'))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        await execa('codebuddy', ['--version'], { timeout: 5000 })
        return true
      } catch {
        try {
          await execa('cbc', ['--version'], { timeout: 5000 })
          return true
        } catch (e) {
          logger.debug(`codebuddy/cbc not available: ${getErrorMessage(e)}`)
          return false
        }
      }
    },
  }
}

// ============ Private Helpers ============

/** 解析可用的二进制名（codebuddy 或 cbc），结果缓存 */
let cachedBinary: string | null = null
async function resolveBinary(): Promise<string> {
  if (cachedBinary) return cachedBinary
  try {
    await execa('codebuddy', ['--version'])
    cachedBinary = 'codebuddy'
  } catch (e) {
    logger.debug(`codebuddy binary not found, falling back to cbc: ${getErrorMessage(e)}`)
    cachedBinary = 'cbc'
  }
  return cachedBinary
}

function buildArgs(
  prompt: string,
  skipPermissions: boolean,
  disableMcp: boolean,
  mcpServers?: string[],
  sessionId?: string,
  stream?: boolean,
  model?: string
): string[] {
  const args: string[] = []

  if (sessionId) {
    args.push('--resume', sessionId)
  }

  if (model) {
    args.push('--model', model)
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

  if (disableMcp) {
    args.push('--strict-mcp-config')
    if (mcpServers?.length) {
      const mcpConfig = buildMcpConfigJson(mcpServers)
      if (mcpConfig) args.push('--mcp-config', mcpConfig)
    }
  }

  args.push(prompt)
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
