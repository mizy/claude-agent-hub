/**
 * Extract readable text from node output.
 * Node outputs are typically objects with { _raw: "markdown text", ...structured } from extractStructuredOutput.
 * Prioritize _raw (original markdown response), fall back to string representation.
 */
export function extractNodeOutputText(output: unknown): string {
  if (!output) return ''
  if (typeof output === 'string') return output
  if (typeof output === 'object' && output !== null && '_raw' in output) {
    const raw = (output as Record<string, unknown>)._raw
    if (typeof raw === 'string') return raw
  }
  return JSON.stringify(output, null, 2)
}
