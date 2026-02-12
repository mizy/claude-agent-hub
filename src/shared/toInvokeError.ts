/**
 * Convert unknown error to typed InvokeError
 *
 * Handles execa-style error objects (timedOut, isCanceled, exitCode)
 */

import type { InvokeError } from '../backend/types.js'

export function toInvokeError(error: unknown, backendName: string): InvokeError {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    if (e.timedOut) return { type: 'timeout', message: `${backendName} 执行超时` }
    if (e.isCanceled) return { type: 'cancelled', message: '执行被取消' }
    return {
      type: 'process',
      message: String(e.message ?? e.shortMessage ?? '未知错误'),
      exitCode: typeof e.exitCode === 'number' ? e.exitCode : undefined,
    }
  }
  return { type: 'process', message: String(error) }
}
