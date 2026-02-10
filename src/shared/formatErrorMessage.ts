/**
 * Extract error message from unknown error value
 *
 * Replaces the repeated pattern: error instanceof Error ? error.message : String(error)
 */
export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
