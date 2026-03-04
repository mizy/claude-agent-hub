/**
 * Claude-compatible output parser
 *
 * Shared by claudeCodeBackend and codebuddyBackend — both use
 * the same JSON output format (type=result with result/session_id/duration/cost fields).
 */

export interface ClaudeCompatJsonOutput {
  type: string
  subtype?: string
  is_error?: boolean
  duration_ms?: number
  duration_api_ms?: number
  result: string
  session_id?: string
  total_cost_usd?: number
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
} {
  // Try single-line JSON
  try {
    const parsed = JSON.parse(raw)
    if (isClaudeCompatJsonOutput(parsed)) {
      return {
        response: parsed.result,
        sessionId: parsed.session_id ?? '',
        durationApiMs: parsed.duration_api_ms,
        costUsd: parsed.total_cost_usd,
      }
    }
  } catch {
    // May be multi-line JSON (stream-json format)
  }

  // Try multi-line JSON — scan for type=result or type=assistant
  const lines = raw.split('\n').filter(line => line.trim())
  let resultLine: ReturnType<typeof parseClaudeCompatOutput> | undefined
  let lastAssistantText = ''
  let lastSessionId = ''
  let lastCostUsd: number | undefined
  let lastDurationApiMs: number | undefined

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>

      // type=result: classic non-streaming / older stream-json format
      if (isClaudeCompatJsonOutput(parsed) && parsed.type === 'result') {
        resultLine = {
          response: parsed.result,
          sessionId: parsed.session_id ?? '',
          durationApiMs: parsed.duration_api_ms,
          costUsd: parsed.total_cost_usd,
        }
      }

      // type=assistant: stream-json with --include-partial-messages
      // Contains the complete message in message.content[]
      if (parsed.type === 'assistant' && parsed.message) {
        const msg = parsed.message as { content?: Array<{ type: string; text?: string }>; id?: string }
        if (msg.content) {
          const text = msg.content
            .filter(b => b.type === 'text' && b.text)
            .map(b => b.text)
            .join('')
          if (text) lastAssistantText = text
        }
      }

      // Extract session_id from any event that carries it
      if (typeof parsed.session_id === 'string' && parsed.session_id) {
        lastSessionId = parsed.session_id
      }
      if (typeof parsed.total_cost_usd === 'number') {
        lastCostUsd = parsed.total_cost_usd
      }
      if (typeof parsed.duration_api_ms === 'number') {
        lastDurationApiMs = parsed.duration_api_ms
      }
    } catch {
      // Continue to next line
    }
  }

  // Prefer type=result if found (has structured cost/session info)
  if (resultLine) {
    // If result has empty response but assistant had text, use assistant text
    if (!resultLine.response && lastAssistantText) {
      resultLine.response = lastAssistantText
    }
    return resultLine
  }

  // Fall back to last assistant event text
  if (lastAssistantText) {
    return {
      response: lastAssistantText,
      sessionId: lastSessionId,
      costUsd: lastCostUsd,
      durationApiMs: lastDurationApiMs,
    }
  }

  // Final fallback: return raw text
  return {
    response: raw.trim(),
    sessionId: '',
  }
}
