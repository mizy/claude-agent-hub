/**
 * 状态管理器
 * 管理工作流和节点的状态转换
 */

import { createLogger } from '../../shared/logger.js'
import { now } from '../../shared/time.js'
import {
  getInstance,
  updateInstanceStatus,
  updateNodeState,
  setNodeOutput,
  getWorkflow,
} from '../store/WorkflowStore.js'
import type {
  WorkflowInstance,
  WorkflowStatus,
  NodeState,
  NodeStatus,
  Workflow,
} from '../types.js'

const logger = createLogger('state-manager')

// ============ 工作流状态转换 ============

export async function startWorkflowInstance(instanceId: string): Promise<void> {
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

export async function pauseWorkflowInstance(instanceId: string): Promise<void> {
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

export async function resumeWorkflowInstance(instanceId: string): Promise<void> {
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

export async function completeWorkflowInstance(instanceId: string): Promise<void> {
  updateInstanceStatus(instanceId, 'completed')
  logger.info(`Workflow instance completed: ${instanceId}`)
}

export async function failWorkflowInstance(instanceId: string, error: string): Promise<void> {
  updateInstanceStatus(instanceId, 'failed', error)
  logger.error(`Workflow instance failed: ${instanceId} - ${error}`)
}

export async function cancelWorkflowInstance(instanceId: string): Promise<void> {
  updateInstanceStatus(instanceId, 'cancelled')
  logger.info(`Workflow instance cancelled: ${instanceId}`)
}

// ============ 节点状态转换 ============

export async function markNodeReady(instanceId: string, nodeId: string): Promise<void> {
  updateNodeState(instanceId, nodeId, {
    status: 'ready',
  })
  logger.debug(`Node ready: ${nodeId}`)
}

export async function markNodeRunning(instanceId: string, nodeId: string): Promise<void> {
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

export async function markNodeDone(
  instanceId: string,
  nodeId: string,
  output?: unknown
): Promise<void> {
  updateNodeState(instanceId, nodeId, {
    status: 'done',
    completedAt: now(),
    result: output,
  })

  if (output !== undefined) {
    setNodeOutput(instanceId, nodeId, output)
  }

  logger.debug(`Node done: ${nodeId}`)
}

export async function markNodeFailed(
  instanceId: string,
  nodeId: string,
  error: string
): Promise<void> {
  updateNodeState(instanceId, nodeId, {
    status: 'failed',
    completedAt: now(),
    error,
  })
  logger.debug(`Node failed: ${nodeId} - ${error}`)
}

export async function markNodeSkipped(instanceId: string, nodeId: string): Promise<void> {
  updateNodeState(instanceId, nodeId, {
    status: 'skipped',
    completedAt: now(),
  })
  logger.debug(`Node skipped: ${nodeId}`)
}

// ============ 状态查询 ============

export function isNodeCompleted(state: NodeState): boolean {
  return state.status === 'done' || state.status === 'skipped'
}

export function isNodeRunnable(state: NodeState): boolean {
  return state.status === 'pending' || state.status === 'ready'
}

export function getActiveNodes(instance: WorkflowInstance): string[] {
  return Object.entries(instance.nodeStates)
    .filter(([_, state]) => state.status === 'running')
    .map(([nodeId]) => nodeId)
}

export function getPendingNodes(instance: WorkflowInstance): string[] {
  return Object.entries(instance.nodeStates)
    .filter(([_, state]) => state.status === 'pending' || state.status === 'ready')
    .map(([nodeId]) => nodeId)
}

export function getCompletedNodes(instance: WorkflowInstance): string[] {
  return Object.entries(instance.nodeStates)
    .filter(([_, state]) => isNodeCompleted(state))
    .map(([nodeId]) => nodeId)
}

export function getFailedNodes(instance: WorkflowInstance): string[] {
  return Object.entries(instance.nodeStates)
    .filter(([_, state]) => state.status === 'failed')
    .map(([nodeId]) => nodeId)
}

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
  if (endState?.status === 'done') {
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
