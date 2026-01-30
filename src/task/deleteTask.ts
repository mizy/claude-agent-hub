/**
 * Delete task by ID
 */

import { getStore } from '../store/index.js'
import { createLogger } from '../shared/logger.js'
import type { Task } from '../types/task.js'

const logger = createLogger('task')

export interface DeleteTaskResult {
  success: boolean
  task?: Task
  error?: string
}

/**
 * Delete a task by ID (supports short ID)
 */
export function deleteTask(id: string): DeleteTaskResult {
  const store = getStore()
  const task = store.getTask(id)

  if (!task) {
    return { success: false, error: `Task not found: ${id}` }
  }

  // Check if task is currently running
  if (task.status === 'planning' || task.status === 'developing') {
    return {
      success: false,
      error: `Cannot delete running task. Stop it first with: cah task stop ${id}`,
    }
  }

  store.deleteTask(task.id)
  logger.info(`Deleted task: ${task.id}`)

  return { success: true, task }
}
