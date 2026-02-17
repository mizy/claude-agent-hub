/**
 * Extract error message from unknown error value
 *
 * @deprecated Use getErrorMessage from './assertError.js' instead.
 * This is a thin wrapper kept for backward compatibility.
 */
import { getErrorMessage } from './assertError.js'

export function formatErrorMessage(error: unknown): string {
  return getErrorMessage(error)
}
