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
import { collectStream } from './collectStream.js'

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

/** Extract text content from an opencode JSON event (supports both old and new format) */
function extractEventText(event: Record<string, unknown>): string | undefined {
  // New format: { type: "text", part: { text: "..." } }
  if (event.type === 'text' && event.part && typeof event.part === 'object') {
    const part = event.part as Record<string, unknown>
    if (typeof part.text === 'string') return part.text
  }
  // Old format: { text: "..." } or { content: "..." } or { result: "..." }
  const text = event.text || event.content || event.result
  return typeof text === 'string' ? text : undefined
}

/** Extract sessionID from an opencode JSON event */
function extractSessionId(event: Record<string, unknown>): string | undefined {
  const id = event.sessionID || event.session_id || event.sessionId
  return typeof id === 'string' ? id : undefined
}

/** 解析 opencode JSON 输出（提取最终 assistant 文本 + sessionId） */
function parseOutput(raw: string): { response: string; sessionId: string } {
  let response = ''
  let sessionId = ''

  const lines = raw.split('\n').filter(l => l.trim())
  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      const sid = extractSessionId(event)
      if (sid) sessionId = sid
      const text = extractEventText(event)
      if (text) response = text
    } catch (e) {
      logger.debug(`Skipping non-JSON line: ${getErrorMessage(e)}`)
    }
  }

  return { response: response || raw.trim(), sessionId }
}

async function streamOutput(
  subprocess: ResultPromise,
  onChunk?: (chunk: string) => void
): Promise<string> {
  return collectStream(subprocess, {
    onChunk,
    processLine(line, cb) {
      try {
        const event = JSON.parse(line)
        const content = extractEventText(event)
        if (content) {
          if (cb) cb(content)
          else process.stdout.write(content)
        }
      } catch (e) {
        logger.debug(`Non-JSON stream line: ${getErrorMessage(e)}`)
        if (!cb) process.stdout.write(line + '\n')
      }
    },
  })
}

