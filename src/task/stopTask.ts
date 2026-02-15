/**
 * Task stop/kill operations
 */

import {
  getTask,
  updateTask,
  getProcessInfo,
  updateProcessInfo,
  isProcessRunning,
} from '../store/TaskStore.js'
import { getTaskInstance } from '../store/TaskWorkflowStore.js'
import { updateInstanceStatus } from '../store/WorkflowStore.js'
import { appendExecutionLog, appendJsonlLog } from '../store/TaskLogStore.js'
import { createLogger } from '../shared/logger.js'
import { getActiveNodes } from '../workflow/index.js'
import type { Task } from '../types/task.js'
import { isStoppableStatus } from '../types/taskStatus.js'

const logger = createLogger('task')

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
