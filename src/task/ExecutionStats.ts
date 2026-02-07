/**
 * 执行统计收集
 *
 * 核心原则：instance.json 是唯一的状态源
 * stats.json 是从 instance 派生的聚合数据
 */

import { saveExecutionStats } from '../store/ExecutionStatsStore.js'
import { getInstance } from '../store/WorkflowStore.js'
import { getTaskWorkflow } from '../store/TaskWorkflowStore.js'
import { workflowEvents } from '../workflow/engine/WorkflowEventEmitter.js'
import { createLogger } from '../shared/logger.js'
import type { WorkflowInstance } from '../workflow/types.js'
import type {
  NodeExecutionStats,
  WorkflowExecutionStats,
} from '../workflow/engine/WorkflowEventEmitter.js'

const logger = createLogger('execution-stats')

/**
 * 从 instance.json 派生执行统计
 * instance 是权威数据源，stats 只是聚合视图
 */
export function deriveStatsFromInstance(
  taskId: string,
  instance: WorkflowInstance,
  workflowName: string
): WorkflowExecutionStats {
  const nodes: NodeExecutionStats[] = []
  let completedNodes = 0
  let failedNodes = 0
  let skippedNodes = 0
  let runningNodes = 0
  let pendingNodes = 0
  let totalCostUsd = 0
  let totalDurationMs = 0
  let completedCount = 0

  for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
    // 从 output 中提取 cost（如果有）
    const output = instance.outputs[nodeId]
    const costUsd =
      typeof output === 'object' && output !== null && 'costUsd' in output
        ? (output as { costUsd?: number }).costUsd
        : undefined

    const nodeStats: NodeExecutionStats = {
      nodeId,
      nodeName: nodeId, // 节点名会在 workflow 中查找
      nodeType: 'task',
      status: mapNodeStatus(state.status),
      attempts: state.attempts,
      durationMs: state.durationMs,
      costUsd,
      error: state.error,
    }

    nodes.push(nodeStats)

    switch (state.status) {
      case 'done':
        completedNodes++
        if (state.durationMs) {
          totalDurationMs += state.durationMs
          completedCount++
        }
        if (costUsd) totalCostUsd += costUsd
        break
      case 'failed':
        failedNodes++
        break
      case 'skipped':
        skippedNodes++
        break
      case 'running':
        runningNodes++
        break
      case 'pending':
      case 'ready':
      case 'waiting':
        pendingNodes++
        break
    }
  }

  // 计算总执行时间
  let execTotalDurationMs = 0
  if (instance.startedAt) {
    const startTime = new Date(instance.startedAt).getTime()
    const endTime = instance.completedAt ? new Date(instance.completedAt).getTime() : Date.now()
    execTotalDurationMs = endTime - startTime
  }

  return {
    workflowId: instance.workflowId,
    instanceId: instance.id,
    workflowName,
    status: instance.status,
    startedAt: instance.startedAt,
    completedAt: instance.completedAt,
    totalDurationMs: execTotalDurationMs,
    nodes,
    summary: {
      totalNodes: nodes.length,
      completedNodes,
      failedNodes,
      skippedNodes,
      runningNodes,
      pendingNodes,
      totalCostUsd,
      avgNodeDurationMs: completedCount > 0 ? Math.round(totalDurationMs / completedCount) : 0,
    },
  }
}

/**
 * 映射节点状态到统计状态
 */
function mapNodeStatus(status: string): NodeExecutionStats['status'] {
  switch (status) {
    case 'done':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'skipped':
      return 'skipped'
    case 'running':
      return 'running'
    default:
      return 'pending'
  }
}

/**
 * 设置增量统计保存
 *
 * 订阅节点事件，从 instance 读取最新状态并保存到 stats.json
 * 这样确保 stats 总是与 instance 同步
 */
export function setupIncrementalStatsSaving(taskId: string, instanceId: string): () => void {
  let lastSaveTime = 0
  const SAVE_DEBOUNCE_MS = 1000

  const saveHandler = (force = false) => {
    const now = Date.now()
    if (!force && now - lastSaveTime < SAVE_DEBOUNCE_MS) {
      return
    }
    lastSaveTime = now

    // 从 instance 读取最新状态（唯一数据源）
    const instance = getInstance(instanceId)
    if (!instance) {
      logger.warn(`Instance not found: ${instanceId}`)
      return
    }

    // 获取 workflow 名称
    const workflow = getTaskWorkflow(taskId)
    const workflowName = workflow?.name || 'Unknown'

    // 从 instance 派生统计
    const stats = deriveStatsFromInstance(taskId, instance, workflowName)

    saveExecutionStats(taskId, stats)
    logger.debug(`Saved stats derived from instance for task ${taskId}`)
  }

  // 订阅节点事件
  const unsubscribe = workflowEvents.onNodeEvent(event => {
    if (
      event.type === 'node:started' ||
      event.type === 'node:completed' ||
      event.type === 'node:failed'
    ) {
      saveHandler(true)
    }
  })

  return unsubscribe
}
