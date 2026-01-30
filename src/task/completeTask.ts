/**
 * Complete a task after review
 */

import { getStore } from '../store/index.js'
import { createLogger } from '../shared/logger.js'
import type { Task } from '../types/task.js'

const logger = createLogger('task')

export interface CompleteTaskResult {
  success: boolean
  task?: Task
  error?: string
}

/**
 * Complete a task (mark as completed after review)
 */
export function completeTask(id: string): CompleteTaskResult {
  const store = getStore()
  const task = store.getTask(id)

  if (!task) {
    return { success: false, error: `Task not found: ${id}` }
  }

  // Only reviewing tasks can be completed
  if (task.status !== 'reviewing') {
    return {
      success: false,
      error: `Task status is ${task.status}, only 'reviewing' tasks can be completed`,
    }
  }

  // Update task status
  store.updateTask(task.id, { status: 'completed' })
  logger.info(`Completed task: ${task.id}`)

  const updatedTask = store.getTask(task.id)
  return { success: true, task: updatedTask ?? task }
}

/**
 * Reject a task (send back for retry)
 */
export function rejectTask(id: string, reason?: string): CompleteTaskResult {
  const store = getStore()
  const task = store.getTask(id)

  if (!task) {
    return { success: false, error: `Task not found: ${id}` }
  }

  // Only reviewing tasks can be rejected
  if (task.status !== 'reviewing') {
    return {
      success: false,
      error: `Task status is ${task.status}, only 'reviewing' tasks can be rejected`,
    }
  }

  // Update task status back to pending for retry
  store.updateTask(task.id, {
    status: 'pending',
    retryCount: task.retryCount + 1,
    lastRejectReason: reason,
  })
  logger.info(`Rejected task: ${task.id}, reason: ${reason || 'not specified'}`)

  const updatedTask = store.getTask(task.id)
  return { success: true, task: updatedTask ?? task }
}
