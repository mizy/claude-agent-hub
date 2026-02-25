/**
 * OpenCode CLI 后端适配器 (v1.x)
 *
 * 非交互模式: opencode run "prompt" -m provider/model --format json
 */

import { execa, type ResultPromise } from 'execa'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import { toInvokeError } from '../shared/toInvokeError.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'
import { collectStderr } from './processHelpers.js'

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
        sessionId,
        signal,
      } = options

      const args = buildArgs(prompt, model, stream, sessionId)
      const startTime = Date.now()

      try {
        const subprocess = execa('opencode', args, {
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

        if (!parsed.response && stderrOutput) {
          const stderrParsed = parseOutput(stderrOutput)
          if (stderrParsed.response) {
            logger.warn(`opencode returned error via stderr: ${stderrParsed.response.slice(0, 200)}`)
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
        return err(toInvokeError(error, 'OpenCode'))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        await execa('opencode', ['--version'], { timeout: 5000 })
        return true
      } catch (e) {
        logger.debug(`opencode not available: ${getErrorMessage(e)}`)
        return false
      }
    },
  }
}

// ============ Private Helpers ============

function buildArgs(
  prompt: string,
  model?: string,
  _stream?: boolean,
  sessionId?: string
): string[] {
  // opencode v1.x: opencode run "prompt" -m provider/model --format json
  // Note: opencode has no --yes flag (unlike claude-code)
  // Always use JSON format — plain text output mixes ANSI codes, tool output,
  // and multiple assistant turns, causing duplicate/garbled replies
  const args: string[] = ['run', prompt]

  if (sessionId) {
    args.push('--session', sessionId)
  }

  if (model) {
    // 支持 "opencode/glm-4.7-free" 或直接 "glm-4.7-free" 格式
    args.push('-m', model.includes('/') ? model : `opencode/${model}`)
  }

  args.push('--format', 'json')

  return args
}

/** 解析 opencode JSON 输出（提取最终 assistant 文本 + sessionId） */
function parseOutput(raw: string): { response: string; sessionId: string } {
  let response = ''
  let sessionId = ''

  const lines = raw.split('\n').filter(l => l.trim())
  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      // Extract sessionID from any event that has it
      if (event.sessionID || event.session_id || event.sessionId) {
        sessionId = event.sessionID || event.session_id || event.sessionId
      }
      // Extract text content — take the last one (final assistant response)
      if (event.text || event.content || event.result) {
        response = event.text || event.content || event.result
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return { response: response || raw.trim(), sessionId }
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

      // Parse complete JSON lines and extract assistant text
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          // Only forward text/content/result fields as AI response
          const content = event.text || event.content || event.result
          if (content) {
            if (onChunk) {
              onChunk(content)
            } else {
              process.stdout.write(content)
            }
          }
        } catch {
          // Non-JSON line — only show in CLI
          if (!onChunk) {
            process.stdout.write(line + '\n')
          }
        }
      }
    }
  }

  await subprocess
  return chunks.join('')
}

