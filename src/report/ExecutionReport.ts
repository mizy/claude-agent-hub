/**
 * 执行报告生成器
 * 生成详细的任务执行报告，支持多种格式输出
 */

import {
  getTask,
  getTaskWorkflow,
  getTaskInstance,
  getExecutionStats,
  getExecutionTimeline,
} from '../task/index.js'
import { createLogger } from '../shared/logger.js'
import type { ExecutionTimeline as TimelineEvent } from '../store/ExecutionStatsStore.js'
import type { NodeExecutionStats } from '../workflow/engine/WorkflowEventEmitter.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'

const logger = createLogger('execution-report')

// ============ 类型定义 ============

export interface ExecutionReport {
  version: '1.0'
  generatedAt: string
  task: {
    id: string
    title: string
    description: string
    status: string
    createdAt: string
  }
  execution: {
    workflowId: string
    instanceId: string
    status: string
    startedAt: string
    completedAt?: string
    totalDurationMs: number
    totalCostUsd: number
  }
  nodes: NodeReport[]
  timeline: TimelineEvent[]
  summary: {
    totalNodes: number
    completedNodes: number
    failedNodes: number
    skippedNodes: number
    successRate: number
    avgNodeDurationMs: number
    totalCostUsd: number
  }
  conversations?: ConversationSummary[]
}

export interface NodeReport {
  id: string
  name: string
  type: string
  status: 'completed' | 'failed' | 'skipped' | 'running' | 'pending'
  attempts: number
  durationMs?: number
  costUsd?: number
  error?: string
  output?: string
}

export interface ConversationSummary {
  nodeId: string
  nodeName: string
  phase: string
  timestamp: string
  promptLength: number
  responseLength: number
  durationMs?: number
  costUsd?: number
}

// ============ 报告生成 ============

/**
 * 生成任务执行报告
 */
export function generateExecutionReport(taskId: string): ExecutionReport | null {
  const task = getTask(taskId)
  if (!task) {
    logger.warn(`Task not found: ${taskId}`)
    return null
  }

  const stats = getExecutionStats(taskId)
  const timeline = getExecutionTimeline(taskId)
  const workflow = getTaskWorkflow(taskId)
  const instance = getTaskInstance(taskId)

  // 构建节点报告
  const nodes = buildNodeReports(workflow, instance, stats?.nodes)

  // 计算汇总数据
  const summary = calculateSummary(nodes, stats?.summary)

  const report: ExecutionReport = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      createdAt: task.createdAt,
    },
    execution: {
      workflowId: workflow?.id || 'unknown',
      instanceId: instance?.id || 'unknown',
      status: instance?.status || task.status,
      startedAt: instance?.startedAt || task.createdAt,
      completedAt: instance?.completedAt,
      totalDurationMs:
        stats?.summary?.avgNodeDurationMs && stats?.summary?.nodesCompleted
          ? stats.summary.avgNodeDurationMs * stats.summary.nodesCompleted
          : 0,
      totalCostUsd: stats?.summary?.totalCostUsd || summary.totalCostUsd,
    },
    nodes,
    timeline,
    summary,
  }

  return report
}

/**
 * 构建节点报告
 */
function buildNodeReports(
  workflow: Workflow | null,
  instance: WorkflowInstance | null,
  nodeStats?: NodeExecutionStats[]
): NodeReport[] {
  if (!workflow) return []

  // 排除 start 和 end 节点
  const taskNodes = workflow.nodes.filter(n => n.type !== 'start' && n.type !== 'end')

  return taskNodes.map(node => {
    const state = instance?.nodeStates[node.id]
    const stats = nodeStats?.find(s => s.nodeId === node.id)

    // 从 outputs 读取节点输出（截断太长的内容）
    let output: string | undefined
    const nodeOutput = instance?.outputs[node.id]
    if (nodeOutput) {
      const resultStr = typeof nodeOutput === 'string' ? nodeOutput : JSON.stringify(nodeOutput)
      output = resultStr.length > 200 ? resultStr.slice(0, 200) + '...' : resultStr
    }

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      status: mapNodeStatus(state?.status || 'pending'),
      attempts: state?.attempts || 0,
      durationMs: stats?.durationMs,
      costUsd: stats?.costUsd,
      error: state?.error,
      output,
    }
  })
}

/**
 * 映射节点状态
 */
function mapNodeStatus(status: string): NodeReport['status'] {
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
 * 计算汇总数据
 */
function calculateSummary(
  nodes: NodeReport[],
  existingSummary?: {
    totalCostUsd?: number
    avgNodeDurationMs?: number
    nodesCompleted?: number
  } | null
): ExecutionReport['summary'] {
  let completedNodes = 0
  let failedNodes = 0
  let skippedNodes = 0
  let totalCostUsd = 0
  let totalDurationMs = 0
  let completedCount = 0

  for (const node of nodes) {
    switch (node.status) {
      case 'completed':
        completedNodes++
        if (node.durationMs) {
          totalDurationMs += node.durationMs
          completedCount++
        }
        if (node.costUsd) totalCostUsd += node.costUsd
        break
      case 'failed':
        failedNodes++
        break
      case 'skipped':
        skippedNodes++
        break
    }
  }

  const totalNodes = nodes.length
  const successRate = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0
  const avgNodeDurationMs = completedCount > 0 ? Math.round(totalDurationMs / completedCount) : 0

  return {
    totalNodes,
    completedNodes,
    failedNodes,
    skippedNodes,
    successRate,
    avgNodeDurationMs: existingSummary?.avgNodeDurationMs || avgNodeDurationMs,
    totalCostUsd: existingSummary?.totalCostUsd || totalCostUsd,
  }
}

// Formatters are in reportFormatters.ts
export { formatReportForTerminal, formatReportForMarkdown } from './reportFormatters.js'
