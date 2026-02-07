/**
 * Process tracking helper
 *
 * Wraps task execution with process.json lifecycle management,
 * ensuring orphan detection works correctly.
 */

import { saveProcessInfo, updateProcessInfo } from '../store/TaskStore.js'

/**
 * Execute a function with process.json tracking.
 * Writes process info before execution and marks stopped after (success or error).
 */
export async function withProcessTracking<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  saveProcessInfo(taskId, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    status: 'running',
  })
  try {
    const result = await fn()
    updateProcessInfo(taskId, { status: 'stopped' })
    return result
  } catch (error) {
    updateProcessInfo(taskId, { status: 'stopped' })
    throw error
  }
}
