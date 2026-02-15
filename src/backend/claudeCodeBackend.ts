/**
 * Claude Code CLI 后端适配器
 *
 * 将 Claude Code CLI 封装为 BackendAdapter 实现
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execa, type ResultPromise } from 'execa'
import chalk from 'chalk'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import { toInvokeError } from '../shared/toInvokeError.js'
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
  event?: {
    type: string
    delta?: { type: string; text?: string }
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
      } = options

      const args = buildArgs(prompt, skipPermissions, disableMcp, mcpServers, sessionId, stream, model)
      const startTime = Date.now()
      const perf = { spawn: 0, firstStdout: 0, firstDelta: 0 }

      try {
        const subprocess = execa('claude', args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: !stream,
        })
        perf.spawn = Date.now() - startTime

        let rawOutput: string
        if (stream) {
          rawOutput = await streamOutput(subprocess, onChunk, startTime, perf)
        } else {
          const result = await subprocess
          rawOutput = result.stdout
        }

        const durationMs = Date.now() - startTime
        logger.info(
          `[perf] spawn: ${perf.spawn}ms, first-stdout: ${perf.firstStdout}ms, first-delta: ${perf.firstDelta}ms, total: ${durationMs}ms`
        )
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
        return err(toInvokeError(error, 'Claude Code'))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        await execa('claude', ['--version'])
        return true
      } catch (e) {
        logger.debug(`claude not available: ${e instanceof Error ? e.message : String(e)}`)
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

  // MCP control: selective enable via --strict-mcp-config + --mcp-config
  if (disableMcp) {
    args.push('--strict-mcp-config')
    // If specific servers requested, pass them via --mcp-config JSON
    if (mcpServers?.length) {
      const mcpConfig = buildMcpConfigJson(mcpServers)
      if (mcpConfig) args.push('--mcp-config', mcpConfig)
    }
  }

  args.push(prompt)
  return args
}

/** Build a JSON string for --mcp-config from Claude Code's global config (~/.claude.json) */
function buildMcpConfigJson(serverNames: string[]): string {
  try {
    const configPath = join(homedir(), '.claude.json')
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)
    const allServers = config.mcpServers ?? {}

    const selected: Record<string, unknown> = {}
    for (const name of serverNames) {
      if (allServers[name]) {
        selected[name] = allServers[name]
      } else {
        logger.warn(`MCP server "${name}" not found in ~/.claude.json, skipping`)
      }
    }

    if (Object.keys(selected).length === 0) return ''
    return JSON.stringify({ mcpServers: selected })
  } catch (e) {
    logger.warn(`Failed to read MCP config: ${e instanceof Error ? e.message : e}`)
    return ''
  }
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
  onChunk?: (chunk: string) => void,
  startTime?: number,
  perf?: { spawn: number; firstStdout: number; firstDelta: number }
): Promise<string> {
  const chunks: string[] = []
  let buffer = ''
  let totalBytes = 0
  let truncated = false

  if (subprocess.stdout) {
    for await (const chunk of subprocess.stdout) {
      const text = chunk.toString()
      totalBytes += Buffer.byteLength(text)

      // Record first stdout arrival
      if (perf && startTime && perf.firstStdout === 0) {
        perf.firstStdout = Date.now() - startTime
      }

      if (!truncated) {
        if (totalBytes > MAX_OUTPUT_BYTES) {
          truncated = true
          logger.warn(
            `Output exceeded ${MAX_OUTPUT_BYTES / 1024 / 1024}MB limit, truncating collection`
          )
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

          // Incremental text deltas (--include-partial-messages)
          if (
            event.type === 'stream_event' &&
            event.event?.type === 'content_block_delta' &&
            event.event.delta?.type === 'text_delta' &&
            event.event.delta.text
          ) {
            // Record first delta (first token from API)
            if (perf && startTime && perf.firstDelta === 0) {
              perf.firstDelta = Date.now() - startTime
            }
            if (onChunk) {
              onChunk(event.event.delta.text)
            } else {
              process.stdout.write(chalk.dim(event.event.delta.text))
            }
          } else if (event.type === 'assistant' && event.message?.content) {
            // Complete assistant turn — only show in CLI when no streaming callback
            if (!onChunk) {
              let assistantText = ''
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  assistantText += block.text
                }
              }
              if (assistantText) {
                process.stdout.write(chalk.dim(assistantText + '\n'))
              }
            }
          } else if (event.type === 'user' && event.tool_use_result) {
            // Tool output (build logs, test output etc.) — only show in CLI, never send to Lark
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

  const output = chunks.join('')
  if (truncated) {
    return (
      output +
      `\n\n[OUTPUT TRUNCATED: exceeded ${MAX_OUTPUT_BYTES / 1024 / 1024}MB limit, ${(totalBytes / 1024 / 1024).toFixed(1)}MB total]`
    )
  }
  return output
}

