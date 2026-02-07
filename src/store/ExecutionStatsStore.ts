/**
 * 执行统计存储
 * 持久化工作流执行统计数据，支持历史查询和分析
 */

import { existsSync, mkdirSync } from 'fs'
import { createLogger } from '../shared/logger.js'
import { formatDuration } from '../shared/formatTime.js'
import { readJson, writeJson } from './readWriteJson.js'
import { getTaskFolder } from './TaskStore.js'
import type {
  WorkflowExecutionStats,
  NodeExecutionStats,
} from '../workflow/engine/WorkflowEventEmitter.js'

const logger = createLogger('execution-stats-store')

// ============ 类型定义 ============

export interface ExecutionSummary {
  taskId: string
  workflowId: string
  instanceId: string
  workflowName: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt?: string
  lastUpdatedAt: string
  totalDurationMs: number
  totalCostUsd: number
  nodesTotal: number
  nodesCompleted: number
  nodesFailed: number
  nodesRunning: number
  avgNodeDurationMs: number
}

export interface ExecutionTimeline {
  timestamp: string
  event:
    | 'workflow:started'
    | 'workflow:resumed'
    | 'node:started'
    | 'node:completed'
    | 'node:failed'
    | 'workflow:completed'
    | 'workflow:failed'
  instanceId: string // 关联到具体的执行实例，用于过滤不同执行的事件（必填）
  nodeId?: string
  nodeName?: string
  details?: string
}

// ============ 存储路径 ============

function getStatsFilePath(taskId: string): string {
  const taskFolder = getTaskFolder(taskId)
  return taskFolder ? `${taskFolder}/stats.json` : ''
}

function getTimelineFilePath(taskId: string): string {
  const taskFolder = getTaskFolder(taskId)
  return taskFolder ? `${taskFolder}/timeline.json` : ''
}

// ============ 存储函数 ============

/**
 * 保存执行统计
 *
 * 注意：这个函数会从传入的 stats 同步状态，确保 stats.json 与 instance.json 一致
 */
export function saveExecutionStats(taskId: string, stats: WorkflowExecutionStats): void {
  const path = getStatsFilePath(taskId)
  if (!path) {
    logger.warn(`Cannot save stats: task folder not found for ${taskId}`)
    return
  }

  // 重新计算节点统计，确保数据一致性
  let completedNodes = 0
  let failedNodes = 0
  let runningNodes = 0
  let totalCostUsd = 0
  let totalDurationMs = 0
  let completedCount = 0

  for (const node of stats.nodes) {
    if (node.status === 'completed') {
      completedNodes++
      if (node.durationMs) {
        totalDurationMs += node.durationMs
        completedCount++
      }
      if (node.costUsd) totalCostUsd += node.costUsd
    } else if (node.status === 'failed') {
      failedNodes++
    } else if (node.status === 'running') {
      runningNodes++
    }
  }

  const now = new Date().toISOString()

  const summary: ExecutionSummary = {
    taskId,
    workflowId: stats.workflowId,
    instanceId: stats.instanceId,
    workflowName: stats.workflowName,
    status: stats.status as ExecutionSummary['status'],
    startedAt: stats.startedAt || now,
    completedAt: stats.completedAt,
    lastUpdatedAt: now,
    totalDurationMs: stats.totalDurationMs,
    // 使用重新计算的值，而不是传入的 summary
    totalCostUsd: totalCostUsd || stats.summary.totalCostUsd,
    nodesTotal: stats.summary.totalNodes,
    nodesCompleted: completedNodes || stats.summary.completedNodes,
    nodesFailed: failedNodes || stats.summary.failedNodes,
    nodesRunning: runningNodes,
    avgNodeDurationMs:
      completedCount > 0
        ? Math.round(totalDurationMs / completedCount)
        : stats.summary.avgNodeDurationMs,
  }

  writeJson(path, {
    summary,
    nodes: stats.nodes,
  })

  logger.debug(
    `Saved execution stats for task ${taskId}: ${completedNodes} completed, ${failedNodes} failed, ${runningNodes} running`
  )
}

/**
 * 读取执行统计
 */
export function getExecutionStats(
  taskId: string
): { summary: ExecutionSummary; nodes: NodeExecutionStats[] } | null {
  const path = getStatsFilePath(taskId)
  if (!path || !existsSync(path)) {
    return null
  }

  return readJson(path, { defaultValue: null })
}

/**
 * 追加时间线事件
 *
 * 特性：
 * - 去重：相同 event + nodeId 组合在短时间内（5秒）不会重复添加
 * - 时间戳严格递增：新事件时间戳至少比最后一个事件晚 1ms
 */
export function appendTimelineEvent(taskId: string, event: ExecutionTimeline): void {
  const path = getTimelineFilePath(taskId)
  if (!path) {
    logger.warn(`Cannot append timeline: task folder not found for ${taskId}`)
    return
  }

  // 确保目录存在
  const taskFolder = getTaskFolder(taskId)
  if (taskFolder && !existsSync(taskFolder)) {
    mkdirSync(taskFolder, { recursive: true })
  }

  // 读取现有时间线或创建新的
  let timeline: ExecutionTimeline[] = []
  if (existsSync(path)) {
    timeline = readJson(path, { defaultValue: [] }) ?? []
  }

  // 去重检查：相同 event + nodeId + instanceId 组合在 5 秒内不重复
  const DEDUP_WINDOW_MS = 5000
  const eventTime = new Date(event.timestamp).getTime()
  const isDuplicate = timeline.some(existing => {
    const existingTime = new Date(existing.timestamp).getTime()
    const timeDiff = Math.abs(eventTime - existingTime)
    return (
      existing.event === event.event &&
      existing.nodeId === event.nodeId &&
      existing.instanceId === event.instanceId &&
      timeDiff < DEDUP_WINDOW_MS
    )
  })

  if (isDuplicate) {
    logger.debug(`Skipping duplicate timeline event: ${event.event} ${event.nodeId || ''}`)
    return
  }

  // 确保时间戳严格递增
  if (timeline.length > 0) {
    const lastEvent = timeline[timeline.length - 1]!
    const lastTime = new Date(lastEvent.timestamp).getTime()
    const newTime = new Date(event.timestamp).getTime()

    if (newTime <= lastTime) {
      // 强制时间戳至少比最后一个事件晚 1ms
      event.timestamp = new Date(lastTime + 1).toISOString()
    }
  }

  timeline.push(event)
  writeJson(path, timeline)
}

/**
 * 读取执行时间线
 */
export function getExecutionTimeline(taskId: string): ExecutionTimeline[] {
  const path = getTimelineFilePath(taskId)
  if (!path || !existsSync(path)) {
    return []
  }

  return readJson(path, { defaultValue: [] }) ?? []
}

/**
 * 读取指定 instance 的执行时间线
 *
 * 过滤只返回属于指定 instanceId 的事件
 */
export function getTimelineForInstance(taskId: string, instanceId: string): ExecutionTimeline[] {
  const allEvents = getExecutionTimeline(taskId)
  return allEvents.filter(event => event.instanceId === instanceId)
}

/**
 * 清理旧 instance 的事件，为新执行做准备
 *
 * 可选操作：
 * - 'archive': 保留旧事件但标记为已归档（默认）
 * - 'remove': 删除旧事件
 */
export function clearTimelineForNewInstance(
  taskId: string,
  newInstanceId: string,
  mode: 'archive' | 'remove' = 'archive'
): void {
  const path = getTimelineFilePath(taskId)
  if (!path) {
    logger.warn(`Cannot clear timeline: task folder not found for ${taskId}`)
    return
  }

  if (!existsSync(path)) {
    return
  }

  const timeline = readJson<ExecutionTimeline[]>(path, { defaultValue: [] }) ?? []

  if (mode === 'remove') {
    // 移除所有旧事件，只保留没有 instanceId 的旧事件（向后兼容）
    const filtered = timeline.filter(event => event.instanceId === newInstanceId)
    writeJson(path, filtered)
    logger.debug(
      `Cleared timeline for new instance ${newInstanceId}, removed ${timeline.length - filtered.length} old events`
    )
  } else {
    // archive 模式：添加一个分隔标记事件
    const separator: ExecutionTimeline = {
      timestamp: new Date().toISOString(),
      event: 'workflow:started',
      instanceId: newInstanceId,
      details: `--- New execution (previous instance events archived) ---`,
    }

    // 检查是否已有此 instance 的开始事件（避免重复添加分隔符）
    const hasNewInstanceEvents = timeline.some(e => e.instanceId === newInstanceId)
    if (!hasNewInstanceEvents) {
      timeline.push(separator)
      writeJson(path, timeline)
      logger.debug(`Added archive separator for new instance ${newInstanceId}`)
    }
  }
}

/**
 * 格式化执行统计为可读字符串
 */
export function formatExecutionSummary(summary: ExecutionSummary): string {
  const lines: string[] = []

  lines.push(`Workflow: ${summary.workflowName}`)
  lines.push(`Status: ${summary.status}`)
  lines.push(`Duration: ${formatDuration(summary.totalDurationMs)}`)
  lines.push(`Cost: $${summary.totalCostUsd.toFixed(4)}`)
  lines.push('')
  lines.push(`Nodes: ${summary.nodesCompleted}/${summary.nodesTotal} completed`)
  if (summary.nodesFailed > 0) {
    lines.push(`Failed: ${summary.nodesFailed} nodes`)
  }
  lines.push(`Avg Node Duration: ${formatDuration(summary.avgNodeDurationMs)}`)

  return lines.join('\n')
}

/**
 * 格式化时间线为可读字符串
 */
export function formatTimeline(timeline: ExecutionTimeline[]): string {
  if (timeline.length === 0) {
    return 'No events recorded'
  }

  const lines: string[] = []
  let prevTime: Date | null = null

  for (const event of timeline) {
    const time = new Date(event.timestamp)
    const timeStr = time.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    // 计算与上一个事件的时间差
    let delta = ''
    if (prevTime) {
      const diffMs = time.getTime() - prevTime.getTime()
      if (diffMs > 0) {
        delta = ` (+${formatDuration(diffMs)})`
      }
    }
    prevTime = time

    // 格式化事件
    let eventStr = ''
    switch (event.event) {
      case 'workflow:started':
        eventStr = 'Workflow started'
        break
      case 'workflow:resumed':
        eventStr = 'Workflow resumed'
        break
      case 'workflow:completed':
        eventStr = 'Workflow completed'
        break
      case 'workflow:failed':
        eventStr = `Workflow failed: ${event.details || 'Unknown error'}`
        break
      case 'node:started':
        eventStr = `[${event.nodeId}] Started: ${event.nodeName || 'unnamed'}`
        break
      case 'node:completed':
        eventStr = `[${event.nodeId}] Completed: ${event.nodeName || 'unnamed'}`
        break
      case 'node:failed':
        eventStr = `[${event.nodeId}] Failed: ${event.nodeName || 'unnamed'} - ${event.details || 'Unknown error'}`
        break
    }

    lines.push(`${timeStr}${delta} ${eventStr}`)
  }

  return lines.join('\n')
}

// Re-export for convenience
export { formatDuration } from '../shared/formatTime.js'
export type {
  NodeExecutionStats,
  WorkflowExecutionStats,
} from '../workflow/engine/WorkflowEventEmitter.js'
