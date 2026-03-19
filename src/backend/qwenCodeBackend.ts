/**
 * qwen-code 后端适配器
 *
 * 非交互模式: qwen "prompt" -m model
 * 恢复会话: qwen "prompt" --continue
 * 输出格式: 纯文本（非 JSON）
 */

import { execa, type ResultPromise } from 'execa'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import { toInvokeError } from '../shared/toInvokeError.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'
import { collectStderr } from './processHelpers.js'
import { collectStream } from './collectStream.js'
import { logCliCommand, buildRedactedCommand } from '../store/conversationLog.js'
import { writeQwenSystemPrompt } from './systemPromptWriter.js'

const logger = createLogger('qwen-code')

export function createQwenCodeBackend(): BackendAdapter {
  return {
    name: 'qwen-code',
    displayName: 'qwen-code',
    cliBinary: 'qwen',

    capabilities: {
      supportsStreaming: true,
      supportsSessionReuse: true,
      supportsCostTracking: false,
      supportsMcpConfig: false,
      supportsAgentTeams: false,
    },

    async invoke(options: InvokeOptions): Promise<Result<InvokeResult, InvokeError>> {
      const {
        prompt: rawPrompt,
        systemPrompt,
        cwd = process.cwd(),
        stream = false,
        skipPermissions = true,
        timeoutMs = 30 * 60 * 1000,
        onChunk,
        model,
        sessionId,
        signal,
      } = options

      // 写入全局 system prompt 配置文件
      if (systemPrompt) {
        writeQwenSystemPrompt(systemPrompt)
      }

      const args = buildArgs(rawPrompt, model, sessionId, skipPermissions)
      const startTime = Date.now()

      logCliCommand({
        backend: 'qwen-code',
        command: buildRedactedCommand('qwen', args, rawPrompt),
        prompt: rawPrompt,
        sessionId,
        model,
        cwd,
      })

      try {
        const subprocess = execa('qwen', args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: stream ? { stdout: false, stderr: true } : true,
          ...(signal ? { cancelSignal: signal, gracefulCancel: true } : {}),
        })

        let rawOutput: string
        let stderrOutput = ''
        if (stream && subprocess.stdout) {
          collectStderr(subprocess, s => { stderrOutput = s })
          rawOutput = await streamOutput(subprocess, onChunk)
        } else {
          const result = await subprocess
          rawOutput = result.stdout
          stderrOutput = result.stderr ?? ''
        }

        const durationMs = Date.now() - startTime
        const parsed = parseOutput(rawOutput)

        // qwen-code may exit 0 but output errors to stderr
        if (!parsed.response && stderrOutput) {
          const stderrParsed = parseOutput(stderrOutput)
          if (stderrParsed.response) {
            logger.warn(`qwen-code returned error via stderr: ${stderrParsed.response.slice(0, 200)}`)
            return err({ type: 'process', message: stderrParsed.response })
          }
        }

        logger.info(`完成 (${(durationMs / 1000).toFixed(1)}s)`)

        return ok({
          prompt: rawPrompt,
          response: parsed.response,
          durationMs,
          sessionId: parsed.sessionId,
        })
      } catch (error: unknown) {
        if (signal?.aborted) {
          return err({ type: 'cancelled', message: 'Chat interrupted by new message' })
        }
        return err(toInvokeError(error, 'qwen-code'))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        await execa('qwen', ['--version'], { timeout: 5000 })
        return true
      } catch (e) {
        logger.debug(`qwen-code not available: ${getErrorMessage(e)}`)
        return false
      }
    },
  }
}

// ============ Private Helpers ============

function buildArgs(prompt: string, model?: string, sessionId?: string, skipPermissions?: boolean): string[] {
  const args: string[] = []

  // 恢复会话
  if (sessionId) {
    args.push('--continue')
  }

  // 跳过权限确认（YOLO 模式）
  if (skipPermissions !== false) {
    args.push('--yolo')
  }

  // 提示词
  args.push(prompt)

  // 模型
  if (model) {
    args.push('-m', model)
  }

  return args
}

/**
 * 解析 qwen-code 输出
 *
 * qwen-code 输出纯文本，无特殊格式
 * sessionId 需要从其他来源获取（如临时文件或环境变量）
 * 目前返回空 sessionId
 */
function parseOutput(raw: string): { response: string; sessionId: string } {
  // qwen-code 输出纯文本，直接返回
  const response = raw.trim()
  return { response, sessionId: '' }
}

async function streamOutput(
  subprocess: ResultPromise,
  onChunk?: (chunk: string) => void
): Promise<string> {
  // qwen-code outputs plain text
  return collectStream(subprocess, { onChunk })
}
