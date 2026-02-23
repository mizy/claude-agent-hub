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
import { toInvokeError } from '../shared/toInvokeError.js'
import { getErrorMessage } from '../shared/assertError.js'
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
        skipPermissions = true,
        timeoutMs = 30 * 60 * 1000,
        onChunk,
        model,
        sessionId,
        signal,
      } = options

      const args = buildArgs(prompt, model, sessionId, skipPermissions)
      const startTime = Date.now()

      try {
        const subprocess = execa('iflow', args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: stream ? { stdout: false, stderr: true } : true,
          ...(signal ? { cancelSignal: signal, gracefulCancel: true } : {}),
        })

        let rawOutput: string
        let stderrOutput = ''
        if (stream && subprocess.stdout) {
          // Capture stderr in parallel for error detection
          collectStderr(subprocess, s => { stderrOutput = s })
          rawOutput = await streamOutput(subprocess, onChunk)
        } else {
          const result = await subprocess
          rawOutput = result.stdout
          stderrOutput = result.stderr ?? ''
        }

        const durationMs = Date.now() - startTime
        const parsed = parseOutput(rawOutput)

        // iflow may exit 0 but output errors to stderr with empty stdout
        if (!parsed.response && stderrOutput) {
          const stderrParsed = parseOutput(stderrOutput)
          if (stderrParsed.response) {
            logger.warn(`iflow returned error via stderr: ${stderrParsed.response.slice(0, 200)}`)
            return err({ type: 'process', message: stderrParsed.response })
          }
        }

        logger.info(`完成 (${(durationMs / 1000).toFixed(1)}s)`)

        return ok({
          prompt,
          response: parsed.response,
          durationMs,
          sessionId: parsed.sessionId,
        })
      } catch (error: unknown) {
        if (signal?.aborted) {
          return err({ type: 'cancelled', message: 'Chat interrupted by new message' })
        }
        return err(toInvokeError(error, 'iflow-cli'))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        await execa('iflow', ['--version'], { timeout: 5000 })
        return true
      } catch (e) {
        logger.debug(`iflow not available: ${getErrorMessage(e)}`)
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
    args.push('-r', sessionId)
  }

  // 非交互模式
  args.push('-p', prompt)

  // 自动确认（YOLO mode）
  if (skipPermissions) {
    args.push('-y')
  }

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

/** Collect stderr output from subprocess (non-blocking, for error detection) */
function collectStderr(subprocess: ResultPromise, onDone: (text: string) => void): void {
  if (!subprocess.stderr) return
  const chunks: string[] = []
  subprocess.stderr.on('data', (chunk: Buffer) => { chunks.push(chunk.toString()) })
  subprocess.stderr.on('end', () => { onDone(chunks.join('')) })
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

