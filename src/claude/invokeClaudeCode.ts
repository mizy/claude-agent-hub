import { execa, type ResultPromise } from 'execa'
import chalk from 'chalk'
import { createLogger } from '../shared/logger.js'
import { ok, err, type Result } from '../shared/result.js'
import type { PersonaConfig } from '../types/persona.js'

const logger = createLogger('claude')

// ============ API 限流 ============

/** 最大并发 Claude API 调用数 */
const MAX_CONCURRENT_CALLS = 5

/** 当前活跃调用数 */
let activeCalls = 0

/** 等待队列 */
const waitQueue: Array<() => void> = []

/** 获取调用许可 */
async function acquireSlot(): Promise<void> {
  if (activeCalls < MAX_CONCURRENT_CALLS) {
    activeCalls++
    return
  }
  // 等待空闲槽位
  return new Promise(resolve => {
    waitQueue.push(() => {
      activeCalls++
      resolve()
    })
  })
}

/** 释放调用许可 */
function releaseSlot(): void {
  activeCalls--
  const next = waitQueue.shift()
  if (next) next()
}

// ============ Types ============

export interface InvokeOptions {
  prompt: string
  mode?: 'plan' | 'execute' | 'review'
  persona?: PersonaConfig
  cwd?: string
  /** 实时输出 Claude 响应，默认 false */
  stream?: boolean
  /** 跳过权限确认，默认 true */
  skipPermissions?: boolean
  /** 超时毫秒数，默认 30 分钟 */
  timeoutMs?: number
  /** 流式输出回调 */
  onChunk?: (chunk: string) => void
  /** 禁用 MCP 服务器，加速启动，默认 false */
  disableMcp?: boolean
  /** 复用已有会话 ID，加速连续任务 */
  sessionId?: string
  /** 模型选择: 'opus' | 'sonnet' | 'haiku' 或完整模型名，默认 'opus' */
  model?: string
}

export interface InvokeResult {
  prompt: string
  response: string
  durationMs: number
  /** 会话 ID，可用于后续调用复用 */
  sessionId: string
  /** API 耗时毫秒数 */
  durationApiMs?: number
  /** 总花费 USD */
  costUsd?: number
}

export type InvokeError =
  | { type: 'timeout'; message: string }
  | { type: 'process'; message: string; exitCode?: number }
  | { type: 'cancelled'; message: string }

// ============ Core ============

/** Claude CLI JSON 输出格式 */
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

/**
 * 调用 Claude Code CLI
 */
export async function invokeClaudeCode(
  options: InvokeOptions
): Promise<Result<InvokeResult, InvokeError>> {
  const {
    prompt,
    mode,
    persona,
    cwd = process.cwd(),
    stream = false,
    skipPermissions = true,
    timeoutMs = 30 * 60 * 1000,
    onChunk,
    disableMcp = false,
    sessionId,
    model = 'opus',
  } = options

  const fullPrompt = buildPrompt(prompt, persona, mode)
  const args = buildArgs(fullPrompt, skipPermissions, disableMcp, sessionId, stream, model)

  logger.info(`[${mode ?? 'default'}] 调用 Claude (${fullPrompt.length} chars)${sessionId ? ` [复用会话 ${sessionId.slice(0, 8)}]` : ''} [slots: ${activeCalls}/${MAX_CONCURRENT_CALLS}]`)
  logger.debug(`Prompt: ${truncate(fullPrompt, 100)}`)

  // 获取调用许可（限流）
  await acquireSlot()
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

    logger.info(`[${mode ?? 'default'}] 完成 (${(durationMs / 1000).toFixed(1)}s, API: ${((parsed.durationApiMs ?? 0) / 1000).toFixed(1)}s)`)

    releaseSlot()
    return ok({
      prompt: fullPrompt,
      response: parsed.response,
      durationMs,
      sessionId: parsed.sessionId,
      durationApiMs: parsed.durationApiMs,
      costUsd: parsed.costUsd,
    })
  } catch (error: unknown) {
    releaseSlot()
    return err(toInvokeError(error))
  }
}

/**
 * 解析 Claude CLI 输出（JSON 或纯文本）
 * 支持两种格式：
 * 1. 单行 JSON (--output-format json)
 * 2. 多行 JSON (--output-format stream-json)
 */
function parseClaudeOutput(raw: string): {
  response: string
  sessionId: string
  durationApiMs?: number
  costUsd?: number
} {
  // 尝试解析为单行 JSON
  try {
    const json = JSON.parse(raw) as ClaudeJsonOutput
    return {
      response: json.result,
      sessionId: json.session_id,
      durationApiMs: json.duration_api_ms,
      costUsd: json.total_cost_usd,
    }
  } catch {
    // 可能是多行 JSON (stream-json 格式)
  }

  // 尝试解析多行 JSON，找到 type=result 的行
  const lines = raw.split('\n').filter(line => line.trim())
  for (const line of lines) {
    try {
      const json = JSON.parse(line) as ClaudeJsonOutput & { type?: string }
      if (json.type === 'result') {
        return {
          response: json.result,
          sessionId: json.session_id,
          durationApiMs: json.duration_api_ms,
          costUsd: json.total_cost_usd,
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

/** stream-json 事件类型 */
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

/**
 * 流式读取 subprocess 输出
 * 支持 stream-json 格式，解析并输出有用的内容
 */
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

      // 尝试按行解析 stream-json
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // 保留未完成的行

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const event = JSON.parse(line) as StreamJsonEvent

          // 提取有用的输出
          let output = ''

          if (event.type === 'assistant' && event.message?.content) {
            // 提取助手的文本内容
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                output += block.text
              }
            }
          } else if (event.type === 'user' && event.tool_use_result) {
            // 提取工具执行结果
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
          // 非 JSON 行，直接输出
          if (onChunk) {
            onChunk(line + '\n')
          } else {
            process.stdout.write(chalk.dim(line + '\n'))
          }
        }
      }
    }
  }

  // 等待进程结束
  await subprocess

  return chunks.join('')
}

// ============ Helpers ============

function buildArgs(
  prompt: string,
  skipPermissions: boolean,
  disableMcp: boolean,
  sessionId?: string,
  stream?: boolean,
  model?: string
): string[] {
  const args: string[] = []

  // 复用已有会话（跳过部分初始化，加速启动）
  if (sessionId) {
    args.push('--resume', sessionId)
  }

  // 指定模型
  if (model) {
    args.push('--model', model)
  }

  args.push('--print')

  // 流式模式使用 stream-json 格式，否则用 json
  // stream-json 支持实时输出，json 只在最后输出
  if (stream) {
    args.push('--output-format', 'stream-json')
    args.push('--verbose') // stream-json 需要 verbose
  } else {
    args.push('--output-format', 'json')
  }

  if (skipPermissions) {
    args.push('--dangerously-skip-permissions')
  }
  if (disableMcp) {
    // 使用 --strict-mcp-config 忽略所有 MCP 配置，加速启动
    // 注意：--mcp-config '{}' 会导致 CLI 卡住，不要使用
    args.push('--strict-mcp-config')
  }

  args.push(prompt)
  return args
}

function buildPrompt(prompt: string, persona?: PersonaConfig, mode?: string): string {
  const parts: string[] = []

  if (persona?.systemPrompt) {
    parts.push(persona.systemPrompt, '')
  }

  const modeInstructions: Record<string, string> = {
    plan: '你现在处于计划模式，请分析任务并生成详细的执行计划。',
    execute: '你现在处于执行模式，请根据计划直接修改代码。',
    review: '你现在处于审查模式，请仔细审查代码变更并提出建议。',
  }

  if (mode && modeInstructions[mode]) {
    parts.push(modeInstructions[mode], '')
  }

  parts.push(prompt)
  return parts.join('\n')
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

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim()
  return oneLine.length <= maxLen ? oneLine : oneLine.slice(0, maxLen) + '...'
}

// ============ Utils ============

/**
 * 检查 Claude Code CLI 是否可用
 */
export async function checkClaudeAvailable(): Promise<boolean> {
  try {
    await execa('claude', ['--version'])
    return true
  } catch {
    return false
  }
}
