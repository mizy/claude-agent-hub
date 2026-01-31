/**
 * Clear tasks by status or all
 */

import {
  getAllTasks,
  deleteTask,
  getProcessInfo,
  isProcessRunning,
} from '../store/TaskStore.js'
import { createLogger } from '../shared/logger.js'
import type { TaskStatus } from '../types/task.js'

const logger = createLogger('task')

export interface ClearTasksResult {
  success: boolean
  count: number
  killedProcesses: number
  error?: string
}

/**
 * Kill process associated with a task
 */
function killTaskProcess(taskId: string): boolean {
  const processInfo = getProcessInfo(taskId)
  if (processInfo && isProcessRunning(processInfo.pid)) {
    try {
      process.kill(processInfo.pid, 'SIGTERM')
      logger.info(`Killed process: ${processInfo.pid} (task: ${taskId})`)
      return true
    } catch {
      // Process may have already exited
    }
  }
  return false
}

/**
 * Clear tasks by status or all completed/failed/cancelled tasks
 * @param options.status - Clear tasks with specific status
 * @param options.all - Clear all tasks and kill running processes
 */
export function clearTasks(options?: {
  status?: TaskStatus
  all?: boolean
}): ClearTasksResult {
  const allTasks = getAllTasks()
  let killedProcesses = 0

  let tasksToDelete: string[] = []

  if (options?.all) {
    // Clear all tasks and kill running processes
    tasksToDelete = allTasks.map(t => t.id)
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

  // Kill processes and delete each task
  for (const id of tasksToDelete) {
    if (killTaskProcess(id)) {
      killedProcesses++
    }
    deleteTask(id)
  }

  logger.info(`Cleared ${tasksToDelete.length} tasks, killed ${killedProcesses} processes`)

  return { success: true, count: tasksToDelete.length, killedProcesses }
}
