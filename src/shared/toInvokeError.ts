/**
 * Convert unknown error to typed InvokeError
 *
 * Handles execa-style error objects (timedOut, isCanceled, exitCode, stderr)
 */

import type { InvokeError } from '../backend/types.js'

export function toInvokeError(error: unknown, backendName: string): InvokeError {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    if (e.timedOut) return { type: 'timeout', message: `${backendName} 执行超时` }
    if (e.isCanceled) return { type: 'cancelled', message: '执行被取消' }

    // Build error message: prefer stderr (actual error detail) over shortMessage (includes full command)
    const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : ''
    const shortMessage = String(e.shortMessage ?? '')
    const message = stderr
      ? `${backendName} failed (exit ${e.exitCode ?? '?'}): ${stderr}`
      : shortMessage || String(e.message ?? '未知错误')

    return {
      type: 'process',
      message,
      exitCode: typeof e.exitCode === 'number' ? e.exitCode : undefined,
    }
  }
  return { type: 'process', message: String(error) }
}
