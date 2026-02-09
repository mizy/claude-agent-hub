/**
 * OpenCode CLI 后端适配器 (v1.x)
 *
 * 非交互模式: opencode run "prompt" -m provider/model --format json
 */

import { execa, type ResultPromise } from 'execa'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'

const logger = createLogger('opencode')

export function createOpencodeBackend(): BackendAdapter {
  return {
    name: 'opencode',
    displayName: 'OpenCode',
    cliBinary: 'opencode',

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
      } = options

      const args = buildArgs(prompt, model, stream)
      const startTime = Date.now()

      try {
        const subprocess = execa('opencode', args, {
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
        const response = parseOutput(rawOutput, stream)

        logger.info(`完成 (${(durationMs / 1000).toFixed(1)}s)`)

        return ok({
          prompt,
          response,
          durationMs,
          sessionId: '',
        })
      } catch (error: unknown) {
        return err(toInvokeError(error))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        await execa('opencode', ['--version'])
        return true
      } catch {
        return false
      }
    },
  }
}

// ============ Private Helpers ============

function buildArgs(prompt: string, model?: string, stream?: boolean): string[] {
  // opencode v1.x: opencode run "prompt" -m provider/model --format json
  const args: string[] = ['run', prompt]

  if (model) {
    // 支持 "opencode/glm-4.7-free" 或直接 "glm-4.7-free" 格式
    args.push('-m', model.includes('/') ? model : `opencode/${model}`)
  }

  if (!stream) {
    args.push('--format', 'json')
  }

  return args
}

/** 解析 opencode 输出 */
function parseOutput(raw: string, stream: boolean): string {
  if (!stream) {
    // JSON 模式：尝试提取最终结果
    try {
      const events = raw.split('\n').filter(l => l.trim())
      // 找最后一个有 text 内容的事件
      for (const line of events.reverse()) {
        const event = JSON.parse(line)
        if (event.text || event.content || event.result) {
          return event.text || event.content || event.result
        }
      }
    } catch {
      // JSON 解析失败，返回原文
    }
  }
  return raw.trim()
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
    if (e.timedOut) return { type: 'timeout', message: 'OpenCode 执行超时' }
    if (e.isCanceled) return { type: 'cancelled', message: '执行被取消' }
    return {
      type: 'process',
      message: String(e.message ?? e.shortMessage ?? '未知错误'),
      exitCode: typeof e.exitCode === 'number' ? e.exitCode : undefined,
    }
  }
  return { type: 'process', message: String(error) }
}
