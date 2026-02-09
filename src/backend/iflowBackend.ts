/**
 * iflow-cli 后端适配器
 *
 * 支持 Qwen3-Coder、DeepSeek-V3、Kimi-K2、GLM-4.6 等免费国产模型
 * 非交互模式: iflow -p "prompt" -y -m model
 */

import { execa, type ResultPromise } from 'execa'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'

const logger = createLogger('iflow')

export function createIflowBackend(): BackendAdapter {
  return {
    name: 'iflow',
    displayName: 'iflow-cli',
    cliBinary: 'iflow',

    capabilities: {
      supportsStreaming: true,
      supportsSessionReuse: true,
      supportsCostTracking: false,
      supportsMcpConfig: false,
      supportsAgentTeams: false,
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
      } = options

      const args = buildArgs(prompt, model, sessionId)
      const startTime = Date.now()

      try {
        const subprocess = execa('iflow', args, {
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
        })
      } catch (error: unknown) {
        return err(toInvokeError(error))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        await execa('iflow', ['--version'])
        return true
      } catch {
        return false
      }
    },
  }
}

// ============ Private Helpers ============

function buildArgs(prompt: string, model?: string, sessionId?: string): string[] {
  const args: string[] = []

  // 恢复会话
  if (sessionId) {
    args.push('-r', sessionId)
  }

  // 非交互模式
  args.push('-p', prompt)
  args.push('-y') // 自动确认（YOLO mode）

  if (model) {
    args.push('-m', model)
  }

  return args
}

/**
 * 解析 iflow 输出
 *
 * iflow stdout 格式：
 *   回答内容
 *
 *   <Execution Info>
 *   { "session-id": "...", "tokenUsage": {...}, ... }
 *   </Execution Info>
 */
function parseOutput(raw: string): { response: string; sessionId: string } {
  const execInfoMatch = raw.match(/<Execution Info>\s*([\s\S]*?)\s*<\/Execution Info>/)

  let sessionId = ''
  if (execInfoMatch) {
    try {
      const info = JSON.parse(execInfoMatch[1]!)
      sessionId = info['session-id'] ?? ''
    } catch {
      // ignore
    }
  }

  // 回答是 <Execution Info> 之前的部分
  const response = execInfoMatch ? raw.slice(0, execInfoMatch.index).trim() : raw.trim()

  return { response, sessionId }
}

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
        process.stdout.write(text)
      }
    }
  }

  await subprocess
  return chunks.join('')
}

function toInvokeError(error: unknown): InvokeError {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    if (e.timedOut) return { type: 'timeout', message: 'iflow-cli 执行超时' }
    if (e.isCanceled) return { type: 'cancelled', message: '执行被取消' }
    return {
      type: 'process',
      message: String(e.message ?? e.shortMessage ?? '未知错误'),
      exitCode: typeof e.exitCode === 'number' ? e.exitCode : undefined,
    }
  }
  return { type: 'process', message: String(error) }
}
