/**
 * Task pause/resume operations
 */

import {
  getTask,
  updateTask,
  getProcessInfo,
  isProcessRunning,
} from '../store/TaskStore.js'
import { getTaskInstance } from '../store/TaskWorkflowStore.js'
import { getInstance as getInstanceById, saveInstance, updateInstanceStatus } from '../store/WorkflowStore.js'
import { resumeWaitingJobsForInstance } from '../workflow/index.js'
import { appendExecutionLog, appendJsonlLog } from '../store/TaskLogStore.js'
import { createLogger } from '../shared/logger.js'
import type { Task } from '../types/task.js'
import { isPausableStatus, isPausedStatus } from '../types/taskStatus.js'

const logger = createLogger('task')

export interface PauseTaskResult {
  success: boolean
  task?: Task
  error?: string
}

/**
 * Pause a running task.
 * Sets task.status to 'paused'. The executing process detects this change
 * via waitForWorkflowCompletion and pauses the NodeWorker.
 * Currently running nodes will complete; no new nodes will start.
 */
export function pauseTask(id: string, reason?: string): PauseTaskResult {
  const task = getTask(id)

  if (!task) {
    return { success: false, error: `Task not found: ${id}` }
  }

  if (!isPausableStatus(task.status)) {
    return {
      success: false,
      error: `Task is ${task.status}, only 'developing' tasks can be paused`,
    }
  }

  // Update task status to paused
  updateTask(task.id, { status: 'paused' })

  // Sync instance status
  const instance = getTaskInstance(task.id)
  if (instance && instance.status === 'running') {
    updateInstanceStatus(instance.id, 'paused')
    // Save pause metadata on instance
    const inst = getInstanceById(instance.id)
    if (inst) {
      inst.pausedAt = new Date().toISOString()
      inst.pauseReason = reason || 'manual'
      saveInstance(inst)
    }
  }

  logger.info(`Paused task: ${task.id}${reason ? ` (reason: ${reason})` : ''}`)

  appendExecutionLog(task.id, `Task paused${reason ? `: ${reason}` : ''}`, { scope: 'lifecycle' })
  appendJsonlLog(task.id, {
    event: 'task_paused',
    message: `Task paused: ${task.title}`,
    data: { reason: reason || 'manual', instanceId: instance?.id },
  })

  const updatedTask = getTask(task.id)
  return { success: true, task: updatedTask ?? task }
}

/**
 * Resume a paused task.
 * Sets task.status back to 'developing'. The executing process detects this
 * via waitForWorkflowCompletion and resumes the NodeWorker.
 */
export function resumePausedTask(id: string): PauseTaskResult {
  const task = getTask(id)

  if (!task) {
    return { success: false, error: `Task not found: ${id}` }
  }

  if (!isPausedStatus(task.status)) {
    return {
      success: false,
      error: `Task is ${task.status}, only 'paused' tasks can be resumed`,
    }
  }

  // Check process is still alive
  const processInfo = getProcessInfo(task.id)
  if (!processInfo || !isProcessRunning(processInfo.pid)) {
    return {
      success: false,
      error: `Task process is not running. Use 'cah task resume ${id}' to restart it instead.`,
    }
  }

  // Update task status back to developing
  updateTask(task.id, { status: 'developing' })

  // Sync instance status
  const instance = getTaskInstance(task.id)
  if (instance && instance.status === 'paused') {
    updateInstanceStatus(instance.id, 'running')
    // Clear pause metadata
    const inst = getInstanceById(instance.id)
    if (inst) {
      inst.pausedAt = undefined
      inst.pauseReason = undefined
      saveInstance(inst)
    }
    // Resume any autoWait jobs that were waiting in the queue
    resumeWaitingJobsForInstance(instance.id)
  }

  logger.info(`Resumed paused task: ${task.id}`)

  appendExecutionLog(task.id, 'Task resumed from pause', { scope: 'lifecycle' })
  appendJsonlLog(task.id, {
    event: 'task_resumed',
    message: `Task resumed: ${task.title}`,
    data: { instanceId: instance?.id },
  })

  const updatedTask = getTask(task.id)
  return { success: true, task: updatedTask ?? task }
}
