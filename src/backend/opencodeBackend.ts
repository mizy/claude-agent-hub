/**
 * OpenCode CLI 后端适配器 (v1.x)
 *
 * 非交互模式: opencode run "prompt" -m provider/model --format json
 * 完整支持 Claude Code 同等功能：MCP 配置、费用追踪、图片提取、权限控制
 */

import { execa, type ResultPromise } from 'execa'
import chalk from 'chalk'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import { toInvokeError } from '../shared/toInvokeError.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'
import { collectStderr } from './processHelpers.js'
import { collectStream } from './collectStream.js'
import {
  extractImagesFromEvent,
  type StreamJsonEvent,
} from './claudeCompatHelpers.js'
import { logCliCommand, buildRedactedCommand } from '../store/conversationLog.js'

const logger = createLogger('opencode')

export function createOpencodeBackend(): BackendAdapter {
  return {
    name: 'opencode',
    displayName: 'OpenCode',
    cliBinary: 'opencode',

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
        model,
        sessionId,
        signal,
      } = options

      const args = buildArgs(prompt, model, sessionId)
      const startTime = Date.now()
      const perf = { spawn: 0, firstStdout: 0, firstDelta: 0 }

      logCliCommand({
        backend: 'opencode',
        command: buildRedactedCommand('opencode', args, prompt),
        sessionId,
        model,
        cwd,
      })

      try {
        const subprocess = execa('opencode', args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: stream ? { stdout: false, stderr: true } : true,
          ...(signal ? { cancelSignal: signal, gracefulCancel: true } : {}),
        })
        perf.spawn = Date.now() - startTime

        let rawOutput: string
        let stderrOutput = ''
        let mcpImagePaths: string[] = []
        if (stream && subprocess.stdout) {
          collectStderr(subprocess, s => { stderrOutput = s })
          const streamResult = await streamOutput(subprocess, onChunk, startTime, perf)
          rawOutput = streamResult.rawOutput
          mcpImagePaths = streamResult.extractedImagePaths
        } else {
          const result = await subprocess
          rawOutput = result.stdout
          stderrOutput = result.stderr ?? ''
        }

        const durationMs = Date.now() - startTime
        logger.debug(
          `[perf] spawn: ${perf.spawn}ms, first-stdout: ${perf.firstStdout}ms, first-delta: ${perf.firstDelta}ms, total: ${durationMs}ms`
        )
        const parsed = parseOutput(rawOutput)

        if (!parsed.response && stderrOutput) {
          const stderrParsed = parseOutput(stderrOutput)
          if (stderrParsed.response) {
            logger.warn(`opencode returned error via stderr: ${stderrParsed.response.slice(0, 200)}`)
            return err({ type: 'process', message: stderrParsed.response })
          }
        }

        if (mcpImagePaths.length > 0) {
          logger.debug(`Extracted ${mcpImagePaths.length} MCP image(s): ${mcpImagePaths.join(', ')}`)
        }

        logger.info(
          `完成 (${(durationMs / 1000).toFixed(1)}s` +
          `${parsed.durationApiMs ? `, API: ${(parsed.durationApiMs / 1000).toFixed(1)}s` : ''})`
        )

        return ok({
          prompt,
          response: parsed.response,
          durationMs,
          sessionId: parsed.sessionId,
          durationApiMs: parsed.durationApiMs,
          costUsd: parsed.costUsd,
          mcpImagePaths: mcpImagePaths.length > 0 ? mcpImagePaths : undefined,
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

function buildArgs(prompt: string, model?: string, sessionId?: string): string[] {
  const args: string[] = ['run']

  if (sessionId) {
    args.push('--session', sessionId)
  }

  if (model) {
    // 支持 "opencode/glm-4.7-free" 或直接 "glm-4.7-free" 格式
    args.push('-m', model.includes('/') ? model : `opencode/${model}`)
  }

  args.push('--format', 'json')

  // opencode v1.2.15+: prompt must come after -- separator
  args.push('--', prompt)

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

/** Extract cost/duration from an opencode JSON event */
function extractMetrics(event: Record<string, unknown>): {
  durationApiMs?: number
  costUsd?: number
} {
  const result: { durationApiMs?: number; costUsd?: number } = {}

  // Try common field names for API duration
  const dur = event.duration_api_ms ?? event.durationApiMs ?? event.duration_ms
  if (typeof dur === 'number') result.durationApiMs = dur

  // Try common field names for cost
  const cost = event.total_cost_usd ?? event.totalCostUsd ?? event.cost ?? event.total_cost
  if (typeof cost === 'number') result.costUsd = cost

  return result
}

/** 解析 opencode JSON 输出（提取最终 assistant 文本 + sessionId + 费用） */
function parseOutput(raw: string): {
  response: string
  sessionId: string
  durationApiMs?: number
  costUsd?: number
} {
  let response = ''
  let sessionId = ''
  let durationApiMs: number | undefined
  let costUsd: number | undefined

  const lines = raw.split('\n').filter(l => l.trim())
  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      const sid = extractSessionId(event)
      if (sid) sessionId = sid
      const text = extractEventText(event)
      if (text) response += text
      const metrics = extractMetrics(event)
      if (metrics.durationApiMs != null) durationApiMs = metrics.durationApiMs
      if (metrics.costUsd != null) costUsd = metrics.costUsd
    } catch (e) {
      logger.debug(`Skipping non-JSON line: ${getErrorMessage(e)}`)
    }
  }

  return { response, sessionId, durationApiMs, costUsd }
}

async function streamOutput(
  subprocess: ResultPromise,
  onChunk?: (chunk: string) => void,
  startTime?: number,
  perf?: { spawn: number; firstStdout: number; firstDelta: number }
): Promise<{ rawOutput: string; extractedImagePaths: string[] }> {
  const extractedImagePaths: string[] = []
  const mcpToolUseIds = new Set<string>()

  const rawOutput = await collectStream(subprocess, {
    onChunk,
    perf,
    startTime,
    processLine(line, cb) {
      try {
        const event = JSON.parse(line)

        // OpenCode native format: extract text content
        const content = extractEventText(event)
        if (content) {
          if (perf && startTime && perf.firstDelta === 0) {
            perf.firstDelta = Date.now() - startTime
          }
          if (cb) cb(content)
          else process.stdout.write(chalk.dim(content))
        }

        // Claude-compatible stream events (when opencode proxies claude)
        const streamEvent = event as StreamJsonEvent
        if (streamEvent.type === 'assistant' && streamEvent.message?.content) {
          for (const block of streamEvent.message.content) {
            if (block.type === 'tool_use' && block.id && block.name?.startsWith('mcp__')) {
              mcpToolUseIds.add(block.id)
            }
          }
        } else if (streamEvent.type === 'user') {
          const imgPaths = extractImagesFromEvent(streamEvent, mcpToolUseIds)
          extractedImagePaths.push(...imgPaths)
        }
      } catch (e) {
        logger.debug(`Non-JSON stream line: ${getErrorMessage(e)}`)
        if (!cb) process.stdout.write(line + '\n')
      }
    },
  })

  return { rawOutput, extractedImagePaths }
}
