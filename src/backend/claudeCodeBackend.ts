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
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'

const logger = createLogger('claude-code')

// ============ Claude JSON 输出格式 ============

interface ClaudeJsonOutput {
  type: string
  subtype: string
  is_error: boolean
  duration_ms: number
  duration_api_ms: number
  result: string
  session_id: string
  total_cost_usd: number
}

/** Validate parsed JSON has the expected shape */
function isClaudeJsonOutput(data: unknown): data is ClaudeJsonOutput {
  return (
    typeof data === 'object' &&
    data !== null &&
    'result' in data &&
    typeof (data as Record<string, unknown>).result === 'string'
  )
}

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
        sessionId,
        model = 'opus',
      } = options

      const args = buildArgs(prompt, skipPermissions, disableMcp, sessionId, stream, model)
      const startTime = Date.now()

      try {
        const subprocess = execa('claude', args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: !stream,
        })

        let rawOutput: string
        if (stream) {
          rawOutput = await streamOutput(subprocess, onChunk)
        } else {
          const result = await subprocess
          rawOutput = result.stdout
        }

        const durationMs = Date.now() - startTime
        const parsed = parseClaudeOutput(rawOutput)

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
        })
      } catch (error: unknown) {
        return err(toInvokeError(error))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        await execa('claude', ['--version'])
        return true
      } catch {
        return false
      }
    },
  }
}

// ============ Private Helpers ============

function buildArgs(
  prompt: string,
  skipPermissions: boolean,
  disableMcp: boolean,
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
  } else {
    args.push('--output-format', 'json')
  }

  if (skipPermissions) {
    args.push('--dangerously-skip-permissions')
  }
  if (disableMcp) {
    args.push('--strict-mcp-config')
  }

  args.push(prompt)
  return args
}

function parseClaudeOutput(raw: string): {
  response: string
  sessionId: string
  durationApiMs?: number
  costUsd?: number
} {
  // 尝试解析为单行 JSON
  try {
    const parsed = JSON.parse(raw)
    if (isClaudeJsonOutput(parsed)) {
      return {
        response: parsed.result,
        sessionId: parsed.session_id ?? '',
        durationApiMs: parsed.duration_api_ms,
        costUsd: parsed.total_cost_usd,
      }
    }
  } catch {
    // 可能是多行 JSON (stream-json 格式)
  }

  // 尝试解析多行 JSON，找到 type=result 的行
  const lines = raw.split('\n').filter(line => line.trim())
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (isClaudeJsonOutput(parsed) && parsed.type === 'result') {
        return {
          response: parsed.result,
          sessionId: parsed.session_id ?? '',
          durationApiMs: parsed.duration_api_ms,
          costUsd: parsed.total_cost_usd,
        }
      }
    } catch {
      // 继续尝试下一行
    }
  }

  // 都解析失败，返回原始文本
  return {
    response: raw,
    sessionId: '',
  }
}

// 100MB max output size to prevent OOM
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024

async function streamOutput(
  subprocess: ResultPromise,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const chunks: string[] = []
  let buffer = ''
  let totalBytes = 0
  let truncated = false

  if (subprocess.stdout) {
    for await (const chunk of subprocess.stdout) {
      const text = chunk.toString()
      totalBytes += Buffer.byteLength(text)

      if (!truncated) {
        if (totalBytes > MAX_OUTPUT_BYTES) {
          truncated = true
          logger.warn(`Output exceeded ${MAX_OUTPUT_BYTES / 1024 / 1024}MB limit, truncating collection`)
        } else {
          chunks.push(text)
        }
      }

      buffer += text

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const event = JSON.parse(line) as StreamJsonEvent
          let output = ''

          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                output += block.text
              }
            }
          } else if (event.type === 'user' && event.tool_use_result) {
            if (event.tool_use_result.stdout) {
              output += event.tool_use_result.stdout
            }
            if (event.tool_use_result.stderr) {
              output += event.tool_use_result.stderr
            }
          }

          if (output) {
            if (onChunk) {
              onChunk(output + '\n')
            } else {
              process.stdout.write(chalk.dim(output + '\n'))
            }
          }
        } catch {
          if (onChunk) {
            onChunk(line + '\n')
          } else {
            process.stdout.write(chalk.dim(line + '\n'))
          }
        }
      }
    }
  }

  await subprocess

  const output = chunks.join('')
  if (truncated) {
    return output + `\n\n[OUTPUT TRUNCATED: exceeded ${MAX_OUTPUT_BYTES / 1024 / 1024}MB limit, ${(totalBytes / 1024 / 1024).toFixed(1)}MB total]`
  }
  return output
}

function toInvokeError(error: unknown): InvokeError {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>

    if (e.timedOut) {
      return { type: 'timeout', message: 'Claude Code 执行超时' }
    }

    if (e.isCanceled) {
      return { type: 'cancelled', message: '执行被取消' }
    }

    return {
      type: 'process',
      message: String(e.message ?? e.shortMessage ?? '未知错误'),
      exitCode: typeof e.exitCode === 'number' ? e.exitCode : undefined,
    }
  }

  return { type: 'process', message: String(error) }
}
