/**
 * Invoke error types (shared between backend and shared layers)
 */

export type InvokeError =
  | { type: 'timeout'; message: string }
  | { type: 'process'; message: string; exitCode?: number }
  | { type: 'cancelled'; message: string }
