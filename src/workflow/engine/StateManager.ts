/**
 * 状态管理器 - 管理工作流和节点的状态转换
 *
 * 导出结构:
 * - WorkflowState: 工作流状态操作 (start, pause, resume, complete, fail, cancel, recover)
 * - NodeState: 节点状态操作 (markReady, markRunning, markDone, markFailed, markSkipped, markWaiting)
 * - StateQuery: 状态查询 (isCompleted, isRunnable, getActive, getPending, getCompleted, getFailed)
 * - checkWorkflowCompletion, getWorkflowProgress: 进度相关
 */

import { createLogger } from '../../shared/logger.js'
import { now } from '../../shared/formatTime.js'
import {
  getInstance,
  updateInstanceStatus,
  updateNodeState,
  setNodeOutput,
} from '../../store/WorkflowStore.js'
import type {
  WorkflowInstance,
  NodeState,
  Workflow,
} from '../types.js'
import {
  isNodeDone,
  isNodeRunning,
  isNodeFailed,
  isNodeWaiting,
} from '../../types/nodeStatus.js'

const logger = createLogger('state-manager')

// ============ 工作流状态转换 (内部实现) ============

async function startWorkflowInstanceFn(instanceId: string): Promise<void> {
  const instance = getInstance(instanceId)
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`)
  }

  if (instance.status !== 'pending') {
    throw new Error(`Cannot start instance in status: ${instance.status}`)
  }

  updateInstanceStatus(instanceId, 'running')
  logger.info(`Workflow instance started: ${instanceId}`)
}

async function pauseWorkflowInstanceFn(instanceId: string): Promise<void> {
  const instance = getInstance(instanceId)
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`)
  }

  if (instance.status !== 'running') {
    throw new Error(`Cannot pause instance in status: ${instance.status}`)
  }

  updateInstanceStatus(instanceId, 'paused')
  logger.info(`Workflow instance paused: ${instanceId}`)
}

async function resumeWorkflowInstanceFn(instanceId: string): Promise<void> {
  const instance = getInstance(instanceId)
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`)
  }

  if (instance.status !== 'paused') {
    throw new Error(`Cannot resume instance in status: ${instance.status}`)
  }

  updateInstanceStatus(instanceId, 'running')
  logger.info(`Workflow instance resumed: ${instanceId}`)
}

async function completeWorkflowInstanceFn(instanceId: string): Promise<void> {
  updateInstanceStatus(instanceId, 'completed')
  logger.info(`Workflow instance completed: ${instanceId}`)
}

async function failWorkflowInstanceFn(instanceId: string, error: string): Promise<void> {
  const errorMessage = error || 'Unknown error (no error message provided)'
  updateInstanceStatus(instanceId, 'failed', errorMessage)
  logger.error(`Workflow instance failed: ${instanceId} - ${errorMessage}`)
}

async function cancelWorkflowInstanceFn(instanceId: string): Promise<void> {
  updateInstanceStatus(instanceId, 'cancelled')
  logger.info(`Workflow instance cancelled: ${instanceId}`)
}

async function recoverWorkflowInstanceFn(instanceId: string): Promise<{
  success: boolean
  failedNodeId?: string
  error?: string
}> {
  const instance = getInstance(instanceId)
  if (!instance) {
    return { success: false, error: `Instance not found: ${instanceId}` }
  }

  if (instance.status !== 'failed') {
    return { success: false, error: `Instance is not in failed status: ${instance.status}` }
  }

  let failedNodeId: string | null = null
  for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
    if (state.status === 'failed' || (state.status === 'pending' && state.attempts >= 3)) {
      failedNodeId = nodeId
      break
    }
  }

  if (!failedNodeId) {
    return { success: false, error: 'No failed node found to recover' }
  }

  updateNodeState(instanceId, failedNodeId, {
    status: 'pending',
    attempts: 0,
    startedAt: undefined,
    completedAt: undefined,
    error: undefined,
  })

  const updatedInstance = getInstance(instanceId)!
  updatedInstance.status = 'running'
  updatedInstance.completedAt = undefined
  updatedInstance.error = undefined

  const { saveInstance } = await import('../../store/WorkflowStore.js')
  saveInstance(updatedInstance)

  logger.info(`Workflow instance recovered: ${instanceId}, will retry node: ${failedNodeId}`)

  return { success: true, failedNodeId }
}

/** 工作流状态操作聚合对象 */
export const WORKFLOW_STATE = {
  start: startWorkflowInstanceFn,
  pause: pauseWorkflowInstanceFn,
  resume: resumeWorkflowInstanceFn,
  complete: completeWorkflowInstanceFn,
  fail: failWorkflowInstanceFn,
  cancel: cancelWorkflowInstanceFn,
  recover: recoverWorkflowInstanceFn,
}

// 兼容性单独导出
export const startWorkflowInstance = startWorkflowInstanceFn
export const pauseWorkflowInstance = pauseWorkflowInstanceFn
export const resumeWorkflowInstance = resumeWorkflowInstanceFn
export const completeWorkflowInstance = completeWorkflowInstanceFn
export const failWorkflowInstance = failWorkflowInstanceFn
export const cancelWorkflowInstance = cancelWorkflowInstanceFn
export const recoverWorkflowInstance = recoverWorkflowInstanceFn

// ============ 节点状态转换 (内部实现) ============

async function markNodeReadyFn(instanceId: string, nodeId: string): Promise<void> {
  updateNodeState(instanceId, nodeId, { status: 'ready' })
  logger.debug(`Node ready: ${nodeId}`)
}

async function markNodeRunningFn(instanceId: string, nodeId: string): Promise<void> {
  const instance = getInstance(instanceId)
  if (!instance) return

  const currentState = instance.nodeStates[nodeId]
  const attempts = (currentState?.attempts || 0) + 1

  updateNodeState(instanceId, nodeId, {
    status: 'running',
    startedAt: now(),
    attempts,
  })
  logger.debug(`Node running: ${nodeId} (attempt ${attempts})`)
}

async function markNodeDoneFn(
  instanceId: string,
  nodeId: string,
  output?: unknown
): Promise<void> {
  const instance = getInstance(instanceId)
  const nodeState = instance?.nodeStates[nodeId]
  const completedAt = now()

  let durationMs: number | undefined
  if (nodeState?.startedAt) {
    durationMs = new Date(completedAt).getTime() - new Date(nodeState.startedAt).getTime()
  }

  updateNodeState(instanceId, nodeId, { status: 'done', completedAt, durationMs })

  if (output !== undefined) {
    setNodeOutput(instanceId, nodeId, output)
  }

  logger.debug(`Node done: ${nodeId}${durationMs ? ` (${durationMs}ms)` : ''}`)
}

async function markNodeFailedFn(
  instanceId: string,
  nodeId: string,
  error: string
): Promise<void> {
  const errorMessage = error || 'Unknown error (no error message provided)'
  updateNodeState(instanceId, nodeId, {
    status: 'failed',
    completedAt: now(),
    error: errorMessage,
  })
  logger.debug(`Node failed: ${nodeId} - ${errorMessage}`)
}

async function markNodeSkippedFn(instanceId: string, nodeId: string): Promise<void> {
  updateNodeState(instanceId, nodeId, { status: 'skipped', completedAt: now() })
  logger.debug(`Node skipped: ${nodeId}`)
}

async function markNodeWaitingFn(instanceId: string, nodeId: string): Promise<void> {
  updateNodeState(instanceId, nodeId, { status: 'waiting' })
  logger.debug(`Node waiting for approval: ${nodeId}`)
}

/** 节点状态操作聚合对象 */
export const NODE_STATE_MARK = {
  ready: markNodeReadyFn,
  running: markNodeRunningFn,
  done: markNodeDoneFn,
  failed: markNodeFailedFn,
  skipped: markNodeSkippedFn,
  waiting: markNodeWaitingFn,
}

// 兼容性单独导出
export const markNodeReady = markNodeReadyFn
export const markNodeRunning = markNodeRunningFn
export const markNodeDone = markNodeDoneFn
export const markNodeFailed = markNodeFailedFn
export const markNodeSkipped = markNodeSkippedFn
export const markNodeWaiting = markNodeWaitingFn

// ============ 状态查询 (内部实现) ============

function isNodeCompletedFn(state: NodeState): boolean {
  return isNodeDone(state.status)
}

function isNodeRunnableFn(state: NodeState): boolean {
  return isNodeWaiting(state.status)
}

function getActiveNodesFn(instance: WorkflowInstance): string[] {
  return Object.entries(instance.nodeStates)
    .filter(([_, state]) => isNodeRunning(state.status))
    .map(([nodeId]) => nodeId)
}

function getPendingNodesFn(instance: WorkflowInstance): string[] {
  return Object.entries(instance.nodeStates)
    .filter(([_, state]) => isNodeWaiting(state.status))
    .map(([nodeId]) => nodeId)
}

function getCompletedNodesFn(instance: WorkflowInstance): string[] {
  return Object.entries(instance.nodeStates)
    .filter(([_, state]) => isNodeCompletedFn(state))
    .map(([nodeId]) => nodeId)
}

function getFailedNodesFn(instance: WorkflowInstance): string[] {
  return Object.entries(instance.nodeStates)
    .filter(([_, state]) => isNodeFailed(state.status))
    .map(([nodeId]) => nodeId)
}

/** 状态查询聚合对象 */
export const STATE_QUERY = {
  isCompleted: isNodeCompletedFn,
  isRunnable: isNodeRunnableFn,
  getActive: getActiveNodesFn,
  getPending: getPendingNodesFn,
  getCompleted: getCompletedNodesFn,
  getFailed: getFailedNodesFn,
}

// 兼容性单独导出
export const isNodeCompleted = isNodeCompletedFn
export const isNodeRunnable = isNodeRunnableFn
export const getActiveNodes = getActiveNodesFn
export const getPendingNodes = getPendingNodesFn
export const getCompletedNodes = getCompletedNodesFn
export const getFailedNodes = getFailedNodesFn

// ============ 工作流完成检查 ============

export function checkWorkflowCompletion(
  instance: WorkflowInstance,
  workflow: Workflow
): { completed: boolean; failed: boolean; error?: string } {
  const endNode = workflow.nodes.find(n => n.type === 'end')
  if (!endNode) {
    return { completed: false, failed: false }
  }

  const endState = instance.nodeStates[endNode.id]

  // end 节点完成 = 工作流完成
  if (endState && isNodeDone(endState.status)) {
    return { completed: true, failed: false }
  }

  // 检查是否有失败节点且无法恢复
  const failedNodes = getFailedNodes(instance)
  if (failedNodes.length > 0) {
    // 检查是否所有失败节点都已超过重试次数
    for (const nodeId of failedNodes) {
      const node = workflow.nodes.find(n => n.id === nodeId)
      const state = instance.nodeStates[nodeId]
      const maxRetries = node?.task?.retries ?? 3

      if (state && state.attempts >= maxRetries) {
        return {
          completed: false,
          failed: true,
          error: `Node ${nodeId} failed after ${state.attempts} attempts: ${state.error}`,
        }
      }
    }
  }

  return { completed: false, failed: false }
}

// ============ 进度统计 ============

export function getWorkflowProgress(
  instance: WorkflowInstance,
  workflow: Workflow
): {
  total: number
  completed: number
  running: number
  pending: number
  failed: number
  percentage: number
} {
  // 排除 start 和 end 节点
  const taskNodes = workflow.nodes.filter(n => n.type !== 'start' && n.type !== 'end')
  const total = taskNodes.length

  let completed = 0
  let running = 0
  let pending = 0
  let failed = 0

  for (const node of taskNodes) {
    const state = instance.nodeStates[node.id]
    switch (state?.status) {
      case 'done':
      case 'skipped':
        completed++
        break
      case 'running':
        running++
        break
      case 'failed':
        failed++
        break
      default:
        pending++
    }
  }

  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

  return { total, completed, running, pending, failed, percentage }
}
