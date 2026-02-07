/**
 * Task lifecycle management: delete, clear, stop, complete, reject
 */

import {
  getTask,
  updateTask,
  getAllTasks,
  deleteTask as deleteTaskFromStore,
  getProcessInfo,
  updateProcessInfo,
  isProcessRunning,
} from '../store/TaskStore.js'
import { getStore } from '../store/index.js'
import { getTaskInstance } from '../store/TaskWorkflowStore.js'
import { updateInstanceStatus } from '../store/WorkflowStore.js'
import { appendExecutionLog, appendJsonlLog } from '../store/TaskLogStore.js'
import { createLogger } from '../shared/logger.js'
import { getActiveNodes } from '../workflow/engine/StateManager.js'
import type { Task, TaskStatus } from '../types/task.js'
import {
  isRunningStatus,
  isTerminalStatus,
  isStoppableStatus,
  isReviewingStatus,
} from '../types/taskStatus.js'

const logger = createLogger('task')

// ============ Delete Task ============

export interface DeleteTaskResult {
  success: boolean
  task?: Task
  error?: string
}

/**
 * Delete a task by ID (supports partial ID match)
 */
export function deleteTask(id: string): DeleteTaskResult {
  const task = getTask(id)

  if (!task) {
    return { success: false, error: `Task not found: ${id}` }
  }

  // Check if task is currently running
  if (isRunningStatus(task.status)) {
    return {
      success: false,
      error: `Cannot delete running task. Stop it first with: cah task stop ${id}`,
    }
  }

  deleteTaskFromStore(task.id)
  logger.info(`Deleted task: ${task.id}`)

  return { success: true, task }
}

// ============ Clear Tasks ============

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
export function clearTasks(options?: { status?: TaskStatus; all?: boolean }): ClearTasksResult {
  const allTasks = getAllTasks()
  let killedProcesses = 0

  let tasksToDelete: string[] = []

  if (options?.all) {
    // Clear all tasks and kill running processes
    tasksToDelete = allTasks.map(t => t.id)
  } else if (options?.status) {
    // Clear tasks with specific status
    tasksToDelete = allTasks.filter(t => t.status === options.status).map(t => t.id)
  } else {
    // Default: clear completed, failed, and cancelled tasks
    tasksToDelete = allTasks.filter(t => isTerminalStatus(t.status)).map(t => t.id)
  }

  // Kill processes and delete each task
  for (const id of tasksToDelete) {
    if (killTaskProcess(id)) {
      killedProcesses++
    }
    deleteTaskFromStore(id)
  }

  logger.info(`Cleared ${tasksToDelete.length} tasks, killed ${killedProcesses} processes`)

  return { success: true, count: tasksToDelete.length, killedProcesses }
}

// ============ Stop Task ============

export interface StopTaskResult {
  success: boolean
  task?: Task
  error?: string
}

/**
 * Stop a running task by ID
 * Changes status to 'cancelled' and releases the agent
 */
export function stopTask(id: string): StopTaskResult {
  const task = getTask(id)

  if (!task) {
    return { success: false, error: `Task not found: ${id}` }
  }

  // Check if task can be stopped
  if (!isStoppableStatus(task.status)) {
    return {
      success: false,
      error: `Task is already ${task.status}, cannot stop`,
    }
  }

  // Kill the process if running
  const processInfo = getProcessInfo(task.id)
  if (processInfo && processInfo.status === 'running' && isProcessRunning(processInfo.pid)) {
    try {
      process.kill(processInfo.pid, 'SIGTERM')
      logger.info(`Killed process: ${processInfo.pid}`)
      // Update process info - the process may not have time to update itself
      updateProcessInfo(task.id, {
        status: 'stopped',
        stopReason: 'killed',
      })
    } catch {
      // Process may have already exited
    }
  }

  // Get current execution state for logging
  const instance = getTaskInstance(task.id)
  const currentNodeInfo = instance ? getActiveNodes(instance).join(', ') : 'unknown'

  // Update task status
  updateTask(task.id, { status: 'cancelled' })

  // Also update instance status to keep them in sync
  if (instance) {
    updateInstanceStatus(instance.id, 'cancelled')
  }
  logger.info(`Stopped task: ${task.id}`)

  // Record stop event to execution log
  appendExecutionLog(
    task.id,
    `Task stopped. Status: ${task.status}, Running nodes: ${currentNodeInfo || 'none'}`,
    { scope: 'lifecycle' }
  )

  // 写入结构化事件日志
  appendJsonlLog(task.id, {
    event: 'task_stopped',
    message: `Task stopped: ${task.title}`,
    data: {
      previousStatus: task.status,
      runningNodes: currentNodeInfo || 'none',
      instanceId: instance?.id,
    },
  })

  // Return updated task
  const updatedTask = getTask(task.id)
  return { success: true, task: updatedTask ?? task }
}

// ============ Complete/Reject Task ============

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
  if (!isReviewingStatus(task.status)) {
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
  if (!isReviewingStatus(task.status)) {
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
