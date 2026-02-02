/**
 * 节点执行日志记录
 *
 * 将节点执行事件记录到时间线和结构化日志
 */

import { appendTimelineEvent } from '../store/ExecutionStatsStore.js'
import { appendJsonlLog } from '../store/TaskLogStore.js'
import { workflowEvents } from './engine/WorkflowEventEmitter.js'
import type { WorkflowNode } from './types.js'

/**
 * 记录节点开始事件
 */
export function logNodeStarted(params: {
  taskId: string | undefined
  workflowId: string
  instanceId: string
  nodeId: string
  node: WorkflowNode
  attempt: number
}): void {
  const { taskId, workflowId, instanceId, nodeId, node, attempt } = params

  // 发射节点开始事件
  workflowEvents.emitNodeStarted({
    workflowId,
    instanceId,
    nodeId,
    nodeName: node.name,
    nodeType: node.type,
    attempt,
  })

  // 记录时间线和结构化日志
  if (taskId) {
    appendTimelineEvent(taskId, {
      timestamp: new Date().toISOString(),
      event: 'node:started',
      instanceId,
      nodeId,
      nodeName: node.name,
    })

    appendJsonlLog(taskId, {
      event: 'node_started',
      nodeId,
      nodeName: node.name,
      message: `Node started: ${node.name}`,
      data: {
        nodeType: node.type,
        attempt,
      },
    })
  }
}

/**
 * 记录节点完成事件
 */
export function logNodeCompleted(params: {
  taskId: string | undefined
  workflowId: string
  instanceId: string
  nodeId: string
  node: WorkflowNode
  durationMs: number
  output?: unknown
  costUsd?: number
}): void {
  const { taskId, workflowId, instanceId, nodeId, node, durationMs, output, costUsd } = params

  // 发射节点完成事件
  workflowEvents.emitNodeCompleted({
    workflowId,
    instanceId,
    nodeId,
    nodeName: node.name,
    nodeType: node.type,
    durationMs,
    output,
    costUsd,
  })

  // 记录时间线和结构化日志
  if (taskId) {
    appendTimelineEvent(taskId, {
      timestamp: new Date().toISOString(),
      event: 'node:completed',
      instanceId,
      nodeId,
      nodeName: node.name,
    })

    appendJsonlLog(taskId, {
      event: 'node_completed',
      nodeId,
      nodeName: node.name,
      message: `Node completed: ${node.name}`,
      durationMs,
      data: {
        nodeType: node.type,
        costUsd,
      },
    })
  }
}

/**
 * 记录节点失败事件
 */
export function logNodeFailed(params: {
  taskId: string | undefined
  workflowId: string
  instanceId: string
  nodeId: string
  node: WorkflowNode
  error: string
  attempt: number
  willRetry: boolean
}): void {
  const { taskId, workflowId, instanceId, nodeId, node, error, attempt, willRetry } = params

  // 发射节点失败事件
  workflowEvents.emitNodeFailed({
    workflowId,
    instanceId,
    nodeId,
    nodeName: node.name,
    nodeType: node.type,
    error,
    attempt,
    willRetry,
  })

  // 记录时间线和结构化日志
  if (taskId) {
    appendTimelineEvent(taskId, {
      timestamp: new Date().toISOString(),
      event: 'node:failed',
      instanceId,
      nodeId,
      nodeName: node.name,
      details: error,
    })

    appendJsonlLog(taskId, {
      event: 'node_failed',
      nodeId,
      nodeName: node.name,
      message: `Node failed: ${node.name}`,
      error,
      data: {
        nodeType: node.type,
        attempt,
        willRetry,
      },
    })
  }
}
