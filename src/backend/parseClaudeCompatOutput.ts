/**
 * Claude-compatible output parser
 *
 * Shared by claudeCodeBackend and codebuddyBackend — both use
 * the same JSON output format (type=result with result/session_id/duration/cost fields).
 */

import {
  extractAssistantTextFromEvent,
  extractEventError,
  extractEventMetrics,
  extractEventSessionId,
  extractEventTextDelta,
  type StreamJsonEvent,
} from './claudeCompatHelpers.js'

export interface ClaudeCompatJsonOutput {
  type: string
  subtype?: string
  is_error?: boolean
  duration_ms?: number
  duration_api_ms?: number
  result: string
  session_id?: string
  total_cost_usd?: number
  usage?: Record<string, unknown>
  tokenUsage?: Record<string, unknown>
  tokens?: Record<string, unknown>
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  prompt_tokens?: number
  completion_tokens?: number
}

export function isClaudeCompatJsonOutput(data: unknown): data is ClaudeCompatJsonOutput {
  return (
    typeof data === 'object' &&
    data !== null &&
    'result' in data &&
    typeof (data as Record<string, unknown>).result === 'string'
  )
}

export function parseClaudeCompatOutput(raw: string): {
  response: string
  sessionId: string
  durationApiMs?: number
  costUsd?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  error?: string
} {
  // Try single-line JSON
  try {
    const parsed = JSON.parse(raw)
    if (isClaudeCompatJsonOutput(parsed)) {
      const metrics = extractEventMetrics(parsed as unknown as Record<string, unknown>)
      return {
        response: parsed.result,
        sessionId: parsed.session_id ?? '',
        durationApiMs: metrics.durationApiMs ?? parsed.duration_api_ms,
        costUsd: metrics.costUsd ?? parsed.total_cost_usd,
        promptTokens: metrics.promptTokens,
        completionTokens: metrics.completionTokens,
        totalTokens: metrics.totalTokens,
      }
    }
  } catch {
    // May be multi-line JSON (stream-json format)
  }

  // Try multi-line JSON — scan for type=result or type=assistant
  const lines = raw.split('\n').filter(line => line.trim())
  let resultLine: ReturnType<typeof parseClaudeCompatOutput> | undefined
  let accumulatedDelta = ''
  let lastAssistantText = ''
  let lastSessionId = ''
  let lastCostUsd: number | undefined
  let lastDurationApiMs: number | undefined
  let lastPromptTokens: number | undefined
  let lastCompletionTokens: number | undefined
  let lastTotalTokens: number | undefined
  let lastError: string | undefined

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const metrics = extractEventMetrics(parsed)
      const eventSessionId = extractEventSessionId(parsed)

      if (eventSessionId) {
        lastSessionId = eventSessionId
      }
      if (metrics.costUsd != null) {
        lastCostUsd = metrics.costUsd
      }
      if (metrics.durationApiMs != null) {
        lastDurationApiMs = metrics.durationApiMs
      }
      if (metrics.promptTokens != null) {
        lastPromptTokens = metrics.promptTokens
      }
      if (metrics.completionTokens != null) {
        lastCompletionTokens = metrics.completionTokens
      }
      if (metrics.totalTokens != null) {
        lastTotalTokens = metrics.totalTokens
      }

      // Accumulate incremental text deltas (OpenCode text events / Claude stream deltas)
      const deltaText = extractEventTextDelta(parsed)
      if (deltaText) {
        accumulatedDelta += deltaText
      }

      // Extract error events
      const errorMsg = extractEventError(parsed)
      if (errorMsg) {
        lastError = errorMsg
      }

      // type=result or type=step_finish: structured result with cost/session info
      if (parsed.type === 'result' || parsed.type === 'step_finish') {
        const hasResult = isClaudeCompatJsonOutput(parsed)
        resultLine = {
          // response='' when hasResult is false (e.g. opencode step_finish without result field);
          // will be backfilled from accumulatedDelta at line 152 via bestResponse fallback
          response: hasResult ? parsed.result : '',
          sessionId: (hasResult ? parsed.session_id : undefined) ?? lastSessionId,
          durationApiMs: metrics.durationApiMs ?? (hasResult ? parsed.duration_api_ms : undefined),
          costUsd: metrics.costUsd ?? (hasResult ? parsed.total_cost_usd : undefined),
          promptTokens: metrics.promptTokens,
          completionTokens: metrics.completionTokens,
          totalTokens: metrics.totalTokens,
        }
      }

      // type=assistant: stream-json with --include-partial-messages
      // Contains the complete message in message.content[]
      if (parsed.type === 'assistant' && parsed.message) {
        const text = extractAssistantTextFromEvent(parsed as unknown as StreamJsonEvent)
        if (text) {
          lastAssistantText = text
        }
      }
    } catch {
      // Continue to next line
    }
  }

  // Best response: prefer result line > accumulated deltas > assistant text > raw
  const bestResponse = resultLine?.response || accumulatedDelta || lastAssistantText

  // Prefer type=result if found (has structured cost/session info)
  if (resultLine) {
    if (!resultLine.response && bestResponse) {
      resultLine.response = bestResponse
    }
    if (resultLine.promptTokens == null) resultLine.promptTokens = lastPromptTokens
    if (resultLine.completionTokens == null) resultLine.completionTokens = lastCompletionTokens
    if (resultLine.totalTokens == null) resultLine.totalTokens = lastTotalTokens
    if (resultLine.costUsd == null) resultLine.costUsd = lastCostUsd
    if (resultLine.durationApiMs == null) resultLine.durationApiMs = lastDurationApiMs
    if (!resultLine.sessionId) resultLine.sessionId = lastSessionId
    if (lastError) resultLine.error = lastError
    return resultLine
  }

  // Fall back to accumulated delta text or last assistant event text
  if (bestResponse) {
    return {
      response: bestResponse,
      sessionId: lastSessionId,
      costUsd: lastCostUsd,
      durationApiMs: lastDurationApiMs,
      promptTokens: lastPromptTokens,
      completionTokens: lastCompletionTokens,
      totalTokens: lastTotalTokens,
      error: lastError,
    }
  }

  // Final fallback: return raw text
  return {
    response: raw.trim(),
    sessionId: lastSessionId,
    error: lastError,
  }
}
