import { execa, type ResultPromise } from 'execa'
import chalk from 'chalk'
import { createLogger } from '../shared/logger.js'
import { ok, err, type Result } from '../shared/result.js'
import type { PersonaConfig } from '../types/persona.js'

const logger = createLogger('claude')

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
}

export interface InvokeResult {
  prompt: string
  response: string
  durationMs: number
}

export type InvokeError =
  | { type: 'timeout'; message: string }
  | { type: 'process'; message: string; exitCode?: number }
  | { type: 'cancelled'; message: string }

// ============ Core ============

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
  } = options

  const fullPrompt = buildPrompt(prompt, persona, mode)
  const args = buildArgs(fullPrompt, skipPermissions)

  logger.info(`[${mode ?? 'default'}] 调用 Claude (${fullPrompt.length} chars)`)
  logger.debug(`Prompt: ${truncate(fullPrompt, 100)}`)

  const startTime = Date.now()
  let response = ''

  try {
    const subprocess = execa('claude', args, {
      cwd,
      timeout: timeoutMs,
      stdin: 'ignore',
      buffer: !stream, // 流式模式不缓冲
    })

    if (stream) {
      response = await streamOutput(subprocess, onChunk)
    } else {
      const result = await subprocess
      response = result.stdout
    }

    const durationMs = Date.now() - startTime
    logger.info(`[${mode ?? 'default'}] 完成 (${(durationMs / 1000).toFixed(1)}s)`)

    return ok({ prompt: fullPrompt, response, durationMs })
  } catch (error: unknown) {
    return err(toInvokeError(error))
  }
}

/**
 * 流式读取 subprocess 输出
 */
async function streamOutput(
  subprocess: ResultPromise,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const chunks: string[] = []

  if (subprocess.stdout) {
    for await (const chunk of subprocess.stdout) {
      const text = chunk.toString()
      chunks.push(text)

      if (onChunk) {
        onChunk(text)
      } else {
        // 默认实时输出到控制台
        process.stdout.write(chalk.dim(text))
      }
    }
  }

  // 等待进程结束
  await subprocess

  return chunks.join('')
}

// ============ Helpers ============

function buildArgs(prompt: string, skipPermissions: boolean): string[] {
  const args = ['--print']
  if (skipPermissions) {
    args.push('--dangerously-skip-permissions')
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
