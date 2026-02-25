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

  // Try multi-line JSON, find type=result line
  const lines = raw.split('\n').filter(line => line.trim())
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (isClaudeCompatJsonOutput(parsed) && parsed.type === 'result') {
        return {
          response: parsed.result,
          sessionId: parsed.session_id ?? '',
          durationApiMs: parsed.duration_api_ms,
          costUsd: parsed.total_cost_usd,
        }
      }
    } catch {
      // Continue to next line
    }
  }

  // Fallback: return raw text
  return {
    response: raw.trim(),
    sessionId: '',
  }
}
