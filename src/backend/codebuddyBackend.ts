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
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'

const logger = createLogger('codebuddy')

interface CodebuddyJsonOutput {
  type: string
  subtype?: string
  is_error?: boolean
  duration_ms?: number
  duration_api_ms?: number
  result: string
  session_id?: string
  total_cost_usd?: number
}

/** Validate parsed JSON has the expected shape */
function isCodebuddyJsonOutput(data: unknown): data is CodebuddyJsonOutput {
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

export function createCodebuddyBackend(): BackendAdapter {
  return {
    name: 'codebuddy',
    displayName: 'CodeBuddy',
    cliBinary: 'codebuddy',

    capabilities: {
      supportsStreaming: true,
      supportsSessionReuse: false,
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
      } = options

      const args = buildArgs(prompt, model, skipPermissions, stream)
      const startTime = Date.now()
      const binary = await resolveBinary()

      try {
        const subprocess = execa(binary, args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: !stream,
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
        return err(toInvokeError(error, 'CodeBuddy'))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        await execa('codebuddy', ['--version'])
        return true
      } catch {
        try {
          await execa('cbc', ['--version'])
          return true
        } catch (e) {
          logger.debug(`codebuddy/cbc not available: ${e instanceof Error ? e.message : String(e)}`)
          return false
        }
      }
    },
  }
}

// ============ Private Helpers ============

/** 解析可用的二进制名（codebuddy 或 cbc） */
async function resolveBinary(): Promise<string> {
  try {
    await execa('codebuddy', ['--version'])
    return 'codebuddy'
  } catch (e) {
    logger.debug(`codebuddy binary not found, falling back to cbc: ${e instanceof Error ? e.message : String(e)}`)
    return 'cbc'
  }
}

function buildArgs(
  prompt: string,
  model?: string,
  skipPermissions?: boolean,
  stream?: boolean
): string[] {
  const args: string[] = []

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

function parseOutput(raw: string): {
  response: string
  sessionId: string
  durationApiMs?: number
  costUsd?: number
} {
  // 尝试单行 JSON
  try {
    const parsed = JSON.parse(raw)
    if (isCodebuddyJsonOutput(parsed)) {
      return {
        response: parsed.result,
        sessionId: parsed.session_id ?? '',
        durationApiMs: parsed.duration_api_ms,
        costUsd: parsed.total_cost_usd,
      }
    }
  } catch {
    // 可能是多行 JSON
  }

  // 多行 JSON，找 type=result
  const lines = raw.split('\n').filter(l => l.trim())
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (isCodebuddyJsonOutput(parsed) && parsed.type === 'result') {
        return {
          response: parsed.result,
          sessionId: parsed.session_id ?? '',
          durationApiMs: parsed.duration_api_ms,
          costUsd: parsed.total_cost_usd,
        }
      }
    } catch {
      // 继续
    }
  }

  return { response: raw.trim(), sessionId: '' }
}

async function streamOutput(
  subprocess: ResultPromise,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const chunks: string[] = []
  let buffer = ''

  if (subprocess.stdout) {
    for await (const chunk of subprocess.stdout) {
      const text = chunk.toString()
      chunks.push(text)
      buffer += text

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as StreamJsonEvent

          // Only forward assistant text as AI response (for Lark/streaming)
          if (event.type === 'assistant' && event.message?.content) {
            let assistantText = ''
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                assistantText += block.text
              }
            }
            if (assistantText) {
              if (onChunk) {
                onChunk(assistantText + '\n')
              } else {
                process.stdout.write(chalk.dim(assistantText + '\n'))
              }
            }
          } else if (event.type === 'user' && event.tool_use_result) {
            // Tool output — only show in CLI, never send to Lark
            const toolOutput =
              (event.tool_use_result.stdout ?? '') + (event.tool_use_result.stderr ?? '')
            if (toolOutput && !onChunk) {
              process.stdout.write(chalk.dim(toolOutput + '\n'))
            }
          }
        } catch {
          // Non-JSON lines — only show in CLI terminal
          if (!onChunk) {
            process.stdout.write(chalk.dim(line + '\n'))
          }
        }
      }
    }
  }

  await subprocess
  return chunks.join('')
}

