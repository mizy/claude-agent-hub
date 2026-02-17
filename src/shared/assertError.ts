/**
 * Error type guards and message extraction utilities.
 */

/** Type guard for Error instances */
export function isError(value: unknown): value is Error {
  return value instanceof Error
}

/** Safely extract error message from unknown thrown value */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/** Safely extract error stack from unknown thrown value */
export function getErrorStack(error: unknown): string | undefined {
  return isError(error) ? error.stack : undefined
}

/** Safely extract error cause from unknown thrown value */
export function getErrorCause(error: unknown): unknown {
  return isError(error) ? error.cause : undefined
}

/** Ensure unknown thrown value is an Error instance */
export function ensureError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(String(value))
}
