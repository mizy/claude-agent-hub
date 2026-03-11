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
import {
  updateInstanceStatus,
  updateInstanceVariables,
  saveInstance,
} from '../store/WorkflowStore.js'
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
 * Changes status to 'stopped' and kills the process
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
    // Safety: never send SIGTERM to the current process (daemon running in-process task)
    if (processInfo.pid === process.pid) {
      logger.warn(
        `Task ${task.id} processInfo.pid (${processInfo.pid}) matches current process — skipping kill to avoid daemon self-termination`
      )
    } else {
      try {
        // Kill the entire process group (negative PID) to also terminate child processes
        // (e.g. claude CLI, cursor-agent spawned by the task process).
        // spawnTaskProcess uses detached:true, making the child a process group leader (pgid = pid).
        process.kill(-processInfo.pid, 'SIGTERM')
        logger.info(`Killed process group: -${processInfo.pid}`)
      } catch {
        // Fallback: kill just the main process if group kill fails
        try {
          process.kill(processInfo.pid, 'SIGTERM')
          logger.info(`Killed process: ${processInfo.pid} (group kill failed, single kill fallback)`)
        } catch {
          // Process may have already exited
        }
      }
    }
    // Update process info regardless
    updateProcessInfo(task.id, {
      status: 'stopped',
      stopReason: 'killed',
    })
  }

  // Get current execution state for logging
  const instance = getTaskInstance(task.id)
  const currentNodeInfo = instance ? getActiveNodes(instance).join(', ') : 'unknown'

  // Update task status
  updateTask(task.id, { status: 'stopped' })

  // Also update instance status to keep them in sync
  if (instance) {
    updateInstanceStatus(instance.id, 'stopped')
    // Clear schedule-wait markers so daemon won't try to resume a cancelled task.
    // Also reset any 'waiting' schedule-wait nodes back to 'pending' so that
    // if the task is later resumed, recoverWorkflowInstance can re-execute them.
    const waitNodeId = instance.variables?._scheduleWaitNodeId as string | undefined
    if (waitNodeId && instance.nodeStates[waitNodeId]?.status === 'waiting') {
      instance.nodeStates[waitNodeId] = {
        ...instance.nodeStates[waitNodeId]!,
        status: 'pending',
        startedAt: undefined,
        completedAt: undefined,
      }
      saveInstance(instance)
    }
    if (instance.variables?._scheduleWaitResumeAt) {
      updateInstanceVariables(instance.id, {
        _scheduleWaitResumeAt: null,
        _scheduleWaitNodeId: null,
      })
    }
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
