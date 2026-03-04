/**
 * Cursor CLI backend adapter
 *
 * Wraps `cursor agent` CLI as a BackendAdapter.
 * Uses `--output-format stream-json` with `--stream-partial-output` for streaming.
 *
 * Key differences from Claude Code CLI:
 * - Subcommand: `cursor agent -p "prompt"` (not `cursor -p "prompt"`)
 * - Permissions: `--force` / `--yolo` (not `--dangerously-skip-permissions`)
 * - Stream events: assistant deltas via `--stream-partial-output` flag
 *   (no `stream_event` wrapper — deltas are assistant events with partial text)
 * - Auth: CURSOR_API_KEY env var or `--api-key` flag
 * - Session resume: `--resume <chatId>`
 */

import { execa, type ResultPromise } from 'execa'
import chalk from 'chalk'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import { toInvokeError } from '../shared/toInvokeError.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'
import { collectStream } from './collectStream.js'
import { logCliCommand, buildRedactedCommand } from '../store/conversationLog.js'

const logger = createLogger('cursor')

// @entry
export function createCursorBackend(): BackendAdapter {
  return {
    name: 'cursor',
    displayName: 'Cursor',
    cliBinary: 'cursor',

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
        sessionId,
        model,
        signal,
      } = options

      const args = buildArgs(prompt, skipPermissions, sessionId, stream, model)
      const startTime = Date.now()
      const perf = { spawn: 0, firstStdout: 0, firstDelta: 0 }

      logCliCommand({
        backend: 'cursor',
        command: buildRedactedCommand('cursor', ['agent', ...args], prompt),
        prompt,
        sessionId,
        model,
        cwd,
      })

      try {
        const subprocess = execa('cursor', ['agent', ...args], {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: stream ? { stdout: false, stderr: true } : true,
          env: process.env,
          ...(signal ? { cancelSignal: signal, gracefulCancel: true } : {}),
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
        logger.debug(
          `[perf] spawn: ${perf.spawn}ms, first-stdout: ${perf.firstStdout}ms, first-delta: ${perf.firstDelta}ms, total: ${durationMs}ms`
        )

        const parsed = parseCursorOutput(rawOutput)

        logger.info(
          `完成 (${(durationMs / 1000).toFixed(1)}s${parsed.durationApiMs ? `, API: ${(parsed.durationApiMs / 1000).toFixed(1)}s` : ''})`
        )

        return ok({
          prompt,
          response: parsed.response,
          durationMs,
          sessionId: parsed.sessionId,
          durationApiMs: parsed.durationApiMs,
        })
      } catch (error: unknown) {
        if (signal?.aborted) {
          return err({ type: 'cancelled', message: 'Chat interrupted by new message' })
        }
        return err(toInvokeError(error, 'Cursor'))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        await execa('cursor', ['--version'], { timeout: 5000 })
        return true
      } catch (e) {
        logger.debug(`cursor not available: ${getErrorMessage(e)}`)
        return false
      }
    },
  }
}

// ============ Private Helpers ============

function buildArgs(
  prompt: string,
  skipPermissions: boolean,
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

  // Non-interactive print mode
  args.push('-p', prompt)

  if (stream) {
    args.push('--output-format', 'stream-json')
    args.push('--stream-partial-output')
  } else {
    args.push('--output-format', 'json')
  }

  if (skipPermissions) {
    args.push('--yolo')
  }

  return args
}

/**
 * Parse Cursor CLI output (both single-line JSON and multi-line stream-json).
 *
 * Cursor stream-json events:
 * - {"type":"system","subtype":"init","session_id":"..."}
 * - {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 * - {"type":"result","subtype":"success","result":"...","session_id":"...","duration_ms":...,"duration_api_ms":...}
 */
function parseCursorOutput(raw: string): {
  response: string
  sessionId: string
  durationApiMs?: number
} {
  // Try single-line JSON (non-streaming result)
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.type === 'result' && typeof parsed.result === 'string') {
      return {
        response: parsed.result,
        sessionId: (parsed.session_id as string) ?? '',
        durationApiMs: parsed.duration_api_ms as number | undefined,
      }
    }
  } catch {
    // Multi-line stream-json
  }

  // Scan multi-line for result and assistant events
  const lines = raw.split('\n').filter(l => l.trim())
  let resultResponse = ''
  let lastAssistantText = ''
  let lastSessionId = ''
  let lastDurationApiMs: number | undefined

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>

      if (event.type === 'result' && typeof event.result === 'string') {
        resultResponse = event.result
        if (typeof event.session_id === 'string') lastSessionId = event.session_id
        if (typeof event.duration_api_ms === 'number') lastDurationApiMs = event.duration_api_ms
      }

      if (event.type === 'assistant' && event.message) {
        const msg = event.message as { content?: Array<{ type: string; text?: string }> }
        if (msg.content) {
          const text = msg.content
            .filter(b => b.type === 'text' && b.text)
            .map(b => b.text)
            .join('')
          if (text) lastAssistantText = text
        }
      }

      if (typeof event.session_id === 'string' && event.session_id) {
        lastSessionId = event.session_id
      }
    } catch {
      // skip
    }
  }

  if (resultResponse) {
    return { response: resultResponse, sessionId: lastSessionId, durationApiMs: lastDurationApiMs }
  }
  if (lastAssistantText) {
    return { response: lastAssistantText, sessionId: lastSessionId, durationApiMs: lastDurationApiMs }
  }

  return { response: raw.trim(), sessionId: '' }
}

/**
 * Cursor stream processor.
 *
 * With `--stream-partial-output`, Cursor emits assistant events with incremental
 * text deltas (each assistant event contains partial content accumulated so far).
 * We track the last seen length and emit only the new portion as a chunk.
 */
async function streamOutput(
  subprocess: ResultPromise,
  onChunk?: (chunk: string) => void,
  startTime?: number,
  perf?: { spawn: number; firstStdout: number; firstDelta: number }
): Promise<string> {
  let lastTextLen = 0

  const processLine = (line: string, cb?: (chunk: string) => void) => {
    try {
      const event = JSON.parse(line) as Record<string, unknown>

      // Assistant events with partial text — extract delta
      if (event.type === 'assistant' && event.message) {
        const msg = event.message as { content?: Array<{ type: string; text?: string }> }
        if (msg.content) {
          const fullText = msg.content
            .filter(b => b.type === 'text' && b.text)
            .map(b => b.text)
            .join('')

          if (fullText.length > lastTextLen) {
            const delta = fullText.slice(lastTextLen)
            lastTextLen = fullText.length

            if (perf && startTime && perf.firstDelta === 0) {
              perf.firstDelta = Date.now() - startTime
            }

            if (cb) cb(delta)
            else process.stdout.write(chalk.dim(delta))
          }
        }
      }

      // Reset text tracking when tool calls happen (assistant text resets between tool calls)
      if (event.type === 'tool_call' && event.subtype === 'started') {
        lastTextLen = 0
      }
    } catch {
      // Non-JSON line, ignore
    }
  }

  return collectStream(subprocess, {
    onChunk,
    perf,
    startTime,
    processLine,
  })
}
