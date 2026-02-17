/**
 * Console 重定向 - 将 task 执行期间的 console 输出同时写入 execution.log
 *
 * 解决问题：当 task 在 daemon 进程内直接执行（非 spawn 子进程）时，
 * 所有 logger 输出通过 console.* 写入 daemon.log，task 的 execution.log 为空。
 *
 * 方案：拦截 console.log/error/warn，将输出同时写入 task 的 execution.log。
 */

import { appendExecutionLog } from '../store/TaskLogStore.js'
import { stripAnsi } from '../shared/logger.js'

/** Whether console is currently redirected (prevent nesting) */
let redirectActive = false

/**
 * Redirect console output to task's execution.log
 *
 * Returns a restore function that MUST be called in finally block.
 * If redirect is already active (nested call), returns a no-op.
 */
export function redirectConsoleToTaskLog(taskId: string): () => void {
  if (redirectActive) {
    return () => {}
  }

  redirectActive = true

  const originalLog = console.log
  const originalError = console.error
  const originalWarn = console.warn

  function intercept(
    original: (...args: unknown[]) => void,
    level: 'info' | 'error' | 'warn'
  ): (...args: unknown[]) => void {
    return (...args: unknown[]) => {
      // Always call original (so daemon.log / foreground terminal still works)
      original(...args)

      // Write to task's execution.log
      try {
        const message = args
          .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' ')
        appendExecutionLog(taskId, stripAnsi(message) + '\n', {
          level,
          scope: 'console',
          raw: true,
        })
      } catch {
        // Best-effort: don't break execution if log write fails
      }
    }
  }

  console.log = intercept(originalLog, 'info')
  console.error = intercept(originalError, 'error')
  console.warn = intercept(originalWarn, 'warn')

  return () => {
    console.log = originalLog
    console.error = originalError
    console.warn = originalWarn
    redirectActive = false
  }
}
