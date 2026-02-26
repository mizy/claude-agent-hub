/**
 * CodeBuddy CLI 后端适配器
 *
 * 腾讯 AI 编程助手，CLI 接口兼容 Claude Code
 * 非交互模式: codebuddy -p "prompt" --output-format json --dangerously-skip-permissions
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

const logger = createLogger('codebuddy')

interface StreamJsonEvent {
  type: string
  message?: {
    content?: Array<{ type: string; text?: string }>
  }
  tool_use_result?: {
    stdout?: string
    stderr?: string
  }
}

export function createCodebuddyBackend(): BackendAdapter {
  return {
    name: 'codebuddy',
    displayName: 'CodeBuddy',
    cliBinary: 'codebuddy',

    capabilities: {
      supportsStreaming: true,
      supportsSessionReuse: true,
      supportsCostTracking: true,
      supportsMcpConfig: false,
      supportsAgentTeams: false,
    },

    async invoke(options: InvokeOptions): Promise<Result<InvokeResult, InvokeError>> {
      const {
        prompt,
        cwd = process.cwd(),
        stream = false,
        skipPermissions = true,
        timeoutMs = 30 * 60 * 1000,
        onChunk,
        model,
        sessionId,
        signal,
      } = options

      const args = buildArgs(prompt, model, skipPermissions, stream, sessionId)
      const startTime = Date.now()
      const binary = await resolveBinary()

      try {
        const subprocess = execa(binary, args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: stream ? { stdout: false, stderr: true } : true,
          ...(signal ? { cancelSignal: signal, gracefulCancel: true } : {}),
        })

        let rawOutput: string
        if (stream && subprocess.stdout) {
          rawOutput = await streamOutput(subprocess, onChunk)
        } else {
          const result = await subprocess
          rawOutput = result.stdout
        }

        const durationMs = Date.now() - startTime
        const parsed = parseOutput(rawOutput)

        logger.info(`完成 (${(durationMs / 1000).toFixed(1)}s)`)

        return ok({
          prompt,
          response: parsed.response,
          durationMs,
          sessionId: parsed.sessionId,
          durationApiMs: parsed.durationApiMs,
          costUsd: parsed.costUsd,
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
  model?: string,
  skipPermissions?: boolean,
  stream?: boolean,
  sessionId?: string
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
  } else {
    args.push('--output-format', 'json')
  }

  if (skipPermissions) {
    args.push('--dangerously-skip-permissions')
  }

  args.push(prompt)
  return args
}

const parseOutput = parseClaudeCompatOutput

async function streamOutput(
  subprocess: ResultPromise,
  onChunk?: (chunk: string) => void
): Promise<string> {
  return collectStream(subprocess, {
    onChunk,
    processLine(line, cb) {
      try {
        const event = JSON.parse(line) as StreamJsonEvent

        if (event.type === 'assistant' && event.message?.content) {
          let assistantText = ''
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              assistantText += block.text
            }
          }
          if (assistantText) {
            if (cb) cb(assistantText + '\n')
            else process.stdout.write(chalk.dim(assistantText + '\n'))
          }
        } else if (event.type === 'user' && event.tool_use_result) {
          const toolOutput =
            (event.tool_use_result.stdout ?? '') + (event.tool_use_result.stderr ?? '')
          if (toolOutput && !cb) {
            process.stdout.write(chalk.dim(toolOutput + '\n'))
          }
        }
      } catch {
        if (!cb) process.stdout.write(chalk.dim(line + '\n'))
      }
    },
  })
}

