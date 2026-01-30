/**
 * Clear tasks by status or all
 */

import { getStore } from '../store/index.js'
import { createLogger } from '../shared/logger.js'
import type { TaskStatus } from '../types/task.js'

const logger = createLogger('task')

export interface ClearTasksResult {
  success: boolean
  count: number
  error?: string
}

/**
 * Clear tasks by status or all completed/failed/cancelled tasks
 */
export function clearTasks(options?: {
  status?: TaskStatus
  all?: boolean
}): ClearTasksResult {
  const store = getStore()
  const allTasks = store.getAllTasks()

  let tasksToDelete: string[] = []

  if (options?.all) {
    // Clear all tasks (except running ones)
    tasksToDelete = allTasks
      .filter(t => t.status !== 'planning' && t.status !== 'developing')
      .map(t => t.id)
  } else if (options?.status) {
    // Clear tasks with specific status
    tasksToDelete = allTasks
      .filter(t => t.status === options.status)
      .map(t => t.id)
  } else {
    // Default: clear completed, failed, and cancelled tasks
    tasksToDelete = allTasks
      .filter(t => ['completed', 'failed', 'cancelled'].includes(t.status))
      .map(t => t.id)
  }

  // Delete each task
  for (const id of tasksToDelete) {
    store.deleteTask(id)
  }

  logger.info(`Cleared ${tasksToDelete.length} tasks`)

  return { success: true, count: tasksToDelete.length }
}
