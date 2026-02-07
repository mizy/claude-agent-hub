/**
 * 执行报告生成器
 * 生成详细的任务执行报告，支持多种格式输出
 */

import {
  getExecutionStats,
  getExecutionTimeline,
  formatDuration,
} from '../store/ExecutionStatsStore.js'
import { getTask } from '../store/TaskStore.js'
import { getTaskWorkflow, getTaskInstance } from '../store/TaskWorkflowStore.js'
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

// ============ 格式化输出 ============

/**
 * 格式化报告为终端输出
 */
export function formatReportForTerminal(report: ExecutionReport): string {
  const lines: string[] = []

  // 标题
  lines.push('═'.repeat(60))
  lines.push(`  执行报告: ${report.task.title}`)
  lines.push('═'.repeat(60))
  lines.push('')

  // 任务信息
  lines.push('【任务信息】')
  lines.push(`  ID: ${report.task.id}`)
  lines.push(`  状态: ${formatStatus(report.task.status)}`)
  lines.push(`  创建时间: ${formatTime(report.task.createdAt)}`)
  lines.push('')

  // 执行信息
  lines.push('【执行信息】')
  lines.push(`  Workflow ID: ${report.execution.workflowId}`)
  lines.push(`  执行状态: ${formatStatus(report.execution.status)}`)
  lines.push(`  开始时间: ${formatTime(report.execution.startedAt)}`)
  if (report.execution.completedAt) {
    lines.push(`  完成时间: ${formatTime(report.execution.completedAt)}`)
  }
  lines.push(`  总耗时: ${formatDuration(report.execution.totalDurationMs)}`)
  lines.push(`  总成本: $${report.execution.totalCostUsd.toFixed(4)}`)
  lines.push('')

  // 汇总
  lines.push('【执行汇总】')
  lines.push(`  总节点数: ${report.summary.totalNodes}`)
  lines.push(`  已完成: ${report.summary.completedNodes} (${report.summary.successRate}%)`)
  if (report.summary.failedNodes > 0) {
    lines.push(`  失败: ${report.summary.failedNodes}`)
  }
  if (report.summary.skippedNodes > 0) {
    lines.push(`  跳过: ${report.summary.skippedNodes}`)
  }
  lines.push(`  平均节点耗时: ${formatDuration(report.summary.avgNodeDurationMs)}`)
  lines.push('')

  // 节点详情
  lines.push('【节点详情】')
  for (const node of report.nodes) {
    const statusIcon = getStatusIcon(node.status)
    const duration = node.durationMs ? ` (${formatDuration(node.durationMs)})` : ''
    const cost = node.costUsd ? ` [$${node.costUsd.toFixed(4)}]` : ''
    lines.push(`  ${statusIcon} ${node.name}${duration}${cost}`)
    if (node.error) {
      lines.push(`     └─ 错误: ${node.error.slice(0, 100)}`)
    }
  }
  lines.push('')

  // 时间线
  if (report.timeline.length > 0) {
    lines.push('【时间线】')
    let prevTime: Date | null = null
    for (const event of report.timeline) {
      const time = new Date(event.timestamp)
      const timeStr = time.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })

      let delta = ''
      if (prevTime) {
        const diffMs = time.getTime() - prevTime.getTime()
        if (diffMs > 0) {
          delta = ` (+${formatDuration(diffMs)})`
        }
      }
      prevTime = time

      const eventStr = formatTimelineEvent(event)
      lines.push(`  ${timeStr}${delta} ${eventStr}`)
    }
    lines.push('')
  }

  lines.push('═'.repeat(60))

  return lines.join('\n')
}

/**
 * 格式化报告为 Markdown
 */
export function formatReportForMarkdown(report: ExecutionReport): string {
  const lines: string[] = []

  lines.push(`# 执行报告: ${report.task.title}`)
  lines.push('')
  lines.push(`> 生成时间: ${formatTime(report.generatedAt)}`)
  lines.push('')

  // 任务信息
  lines.push('## 任务信息')
  lines.push('')
  lines.push('| 属性 | 值 |')
  lines.push('|------|-----|')
  lines.push(`| ID | \`${report.task.id}\` |`)
  lines.push(`| 状态 | ${formatStatus(report.task.status)} |`)
  lines.push(`| 创建时间 | ${formatTime(report.task.createdAt)} |`)
  lines.push('')

  // 执行信息
  lines.push('## 执行信息')
  lines.push('')
  lines.push('| 属性 | 值 |')
  lines.push('|------|-----|')
  lines.push(`| Workflow ID | \`${report.execution.workflowId}\` |`)
  lines.push(`| 执行状态 | ${formatStatus(report.execution.status)} |`)
  lines.push(`| 开始时间 | ${formatTime(report.execution.startedAt)} |`)
  if (report.execution.completedAt) {
    lines.push(`| 完成时间 | ${formatTime(report.execution.completedAt)} |`)
  }
  lines.push(`| 总耗时 | ${formatDuration(report.execution.totalDurationMs)} |`)
  lines.push(`| 总成本 | $${report.execution.totalCostUsd.toFixed(4)} |`)
  lines.push('')

  // 汇总
  lines.push('## 执行汇总')
  lines.push('')
  lines.push(`- **总节点数**: ${report.summary.totalNodes}`)
  lines.push(`- **成功率**: ${report.summary.successRate}%`)
  lines.push(`- **已完成**: ${report.summary.completedNodes}`)
  lines.push(`- **失败**: ${report.summary.failedNodes}`)
  lines.push(`- **跳过**: ${report.summary.skippedNodes}`)
  lines.push(`- **平均节点耗时**: ${formatDuration(report.summary.avgNodeDurationMs)}`)
  lines.push('')

  // 节点详情
  lines.push('## 节点详情')
  lines.push('')
  lines.push('| 节点 | 类型 | 状态 | 耗时 | 成本 |')
  lines.push('|------|------|------|------|------|')
  for (const node of report.nodes) {
    const duration = node.durationMs ? formatDuration(node.durationMs) : '-'
    const cost = node.costUsd ? `$${node.costUsd.toFixed(4)}` : '-'
    const status = `${getStatusIcon(node.status)} ${node.status}`
    lines.push(`| ${node.name} | ${node.type} | ${status} | ${duration} | ${cost} |`)
  }
  lines.push('')

  // 失败节点详情
  const failedNodes = report.nodes.filter(n => n.error)
  if (failedNodes.length > 0) {
    lines.push('### 错误详情')
    lines.push('')
    for (const node of failedNodes) {
      lines.push(`#### ${node.name}`)
      lines.push('```')
      lines.push(node.error || 'Unknown error')
      lines.push('```')
      lines.push('')
    }
  }

  // 时间线
  if (report.timeline.length > 0) {
    lines.push('## 时间线')
    lines.push('')
    lines.push('```')
    for (const event of report.timeline) {
      const timeStr = new Date(event.timestamp).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      const eventStr = formatTimelineEvent(event)
      lines.push(`${timeStr} ${eventStr}`)
    }
    lines.push('```')
    lines.push('')
  }

  return lines.join('\n')
}

// ============ 辅助函数 ============

function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    pending: '⏳ 等待中',
    planning: '📝 计划中',
    developing: '🔧 执行中',
    running: '🔧 执行中',
    completed: '✅ 已完成',
    failed: '❌ 失败',
    cancelled: '⚫ 已取消',
  }
  return statusMap[status] || status
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function getStatusIcon(status: NodeReport['status']): string {
  switch (status) {
    case 'completed':
      return '✓'
    case 'failed':
      return '✗'
    case 'skipped':
      return '○'
    case 'running':
      return '►'
    default:
      return '·'
  }
}

function formatTimelineEvent(event: TimelineEvent): string {
  switch (event.event) {
    case 'workflow:started':
      return 'Workflow 开始'
    case 'workflow:completed':
      return 'Workflow 完成'
    case 'workflow:failed':
      return `Workflow 失败: ${event.details || 'Unknown error'}`
    case 'node:started':
      return `[${event.nodeId}] 开始: ${event.nodeName || 'unnamed'}`
    case 'node:completed':
      return `[${event.nodeId}] 完成: ${event.nodeName || 'unnamed'}`
    case 'node:failed':
      return `[${event.nodeId}] 失败: ${event.nodeName || 'unnamed'} - ${event.details || ''}`
    default:
      return event.event
  }
}

// 导出 formatDuration 以便其他模块使用
export { formatDuration }
