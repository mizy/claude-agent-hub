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
import { getTaskInstance, getTaskWorkflow, saveTaskWorkflow } from '../store/TaskWorkflowStore.js'
import { getInstance as getInstanceById, saveInstance, updateInstanceStatus } from '../store/WorkflowStore.js'
import { resumeWaitingJobsForInstance } from '../workflow/queue/WorkflowQueue.js'
import { appendExecutionLog, appendJsonlLog } from '../store/TaskLogStore.js'
import { createLogger } from '../shared/logger.js'
import { generateId } from '../shared/generateId.js'
import { getActiveNodes } from '../workflow/engine/StateManager.js'
import type { Task, TaskStatus } from '../types/task.js'
import {
  isRunningStatus,
  isTerminalStatus,
  isStoppableStatus,
  isReviewingStatus,
  isPausableStatus,
  isPausedStatus,
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

// ============ Pause/Resume Task ============

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

// ============ Inject Node ============

export interface InjectNodeResult {
  success: boolean
  nodeId?: string
  error?: string
}

/**
 * Inject a new task node into a running workflow.
 * The new node is inserted after the currently running/latest completed node
 * and before its downstream nodes.
 */
export function injectNode(taskId: string, nodePrompt: string, persona = 'Pragmatist'): InjectNodeResult {
  const task = getTask(taskId)
  if (!task) {
    return { success: false, error: `Task not found: ${taskId}` }
  }

  if (isTerminalStatus(task.status)) {
    return { success: false, error: `Task is already ${task.status}` }
  }

  const workflow = getTaskWorkflow(taskId)
  const instance = getTaskInstance(taskId)

  if (!workflow || !instance) {
    return { success: false, error: 'No workflow or instance found for this task' }
  }

  // Find the "anchor" node: the currently running node, or the last completed node
  let anchorNodeId: string | null = null

  // First try to find a running node
  for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
    if (state.status === 'running') {
      anchorNodeId = nodeId
      break
    }
  }

  // If no running node, find the most recently completed node (by completedAt)
  if (!anchorNodeId) {
    let latestTime = 0
    for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
      if (state.status === 'done' && state.completedAt) {
        const time = new Date(state.completedAt).getTime()
        if (time > latestTime) {
          latestTime = time
          anchorNodeId = nodeId
        }
      }
    }
  }

  if (!anchorNodeId) {
    return { success: false, error: 'No running or completed node found to inject after' }
  }

  // Create new node
  const newNodeId = `injected-${generateId().slice(0, 8)}`
  const newNode = {
    id: newNodeId,
    type: 'task' as const,
    name: `[注入] ${nodePrompt.slice(0, 30)}`,
    description: nodePrompt,
    task: {
      persona,
      prompt: nodePrompt,
    },
  }

  // Find edges going out from anchor node
  const outEdges = workflow.edges.filter(e => e.from === anchorNodeId)

  // Re-wire: anchor → newNode → (original targets)
  // Remove old edges from anchor
  workflow.edges = workflow.edges.filter(e => e.from !== anchorNodeId)

  // Add edge: anchor → newNode
  workflow.edges.push({
    id: `edge-${generateId().slice(0, 8)}`,
    from: anchorNodeId,
    to: newNodeId,
  })

  // Add edges: newNode → each original target
  for (const edge of outEdges) {
    workflow.edges.push({
      id: `edge-${generateId().slice(0, 8)}`,
      from: newNodeId,
      to: edge.to,
      condition: edge.condition,
    })
  }

  // Add node to workflow
  workflow.nodes.push(newNode)

  // Add node state to instance
  instance.nodeStates[newNodeId] = { status: 'pending', attempts: 0 }

  // Save both
  saveTaskWorkflow(taskId, workflow)
  saveInstance(instance)

  logger.info(`Injected node ${newNodeId} into task ${taskId} after ${anchorNodeId}`)

  appendExecutionLog(taskId, `Node injected: ${newNode.name} (after ${anchorNodeId})`, { scope: 'lifecycle' })
  appendJsonlLog(taskId, {
    event: 'node_injected',
    message: `Node injected: ${newNode.name}`,
    data: { nodeId: newNodeId, afterNode: anchorNodeId, prompt: nodePrompt },
  })

  return { success: true, nodeId: newNodeId }
}
