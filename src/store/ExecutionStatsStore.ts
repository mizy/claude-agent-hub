/**
 * 执行统计存储
 * 持久化工作流执行统计数据，支持历史查询和分析
 */

import { existsSync, mkdirSync } from 'fs'
import { createLogger } from '../shared/logger.js'
import { readJson, writeJson } from './json.js'
import { getTaskFolder } from './TaskStore.js'
import type { WorkflowExecutionStats, NodeExecutionStats } from '../workflow/engine/WorkflowEventEmitter.js'

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
  totalDurationMs: number
  totalCostUsd: number
  nodesTotal: number
  nodesCompleted: number
  nodesFailed: number
  avgNodeDurationMs: number
}

export interface ExecutionTimeline {
  timestamp: string
  event: 'workflow:started' | 'node:started' | 'node:completed' | 'node:failed' | 'workflow:completed' | 'workflow:failed'
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
 */
export function saveExecutionStats(taskId: string, stats: WorkflowExecutionStats): void {
  const path = getStatsFilePath(taskId)
  if (!path) {
    logger.warn(`Cannot save stats: task folder not found for ${taskId}`)
    return
  }

  const summary: ExecutionSummary = {
    taskId,
    workflowId: stats.workflowId,
    instanceId: stats.instanceId,
    workflowName: stats.workflowName,
    status: stats.status as ExecutionSummary['status'],
    startedAt: stats.startedAt || new Date().toISOString(),
    completedAt: stats.completedAt,
    totalDurationMs: stats.totalDurationMs,
    totalCostUsd: stats.summary.totalCostUsd,
    nodesTotal: stats.summary.totalNodes,
    nodesCompleted: stats.summary.completedNodes,
    nodesFailed: stats.summary.failedNodes,
    avgNodeDurationMs: stats.summary.avgNodeDurationMs,
  }

  writeJson(path, {
    summary,
    nodes: stats.nodes,
  })

  logger.debug(`Saved execution stats for task ${taskId}`)
}

/**
 * 读取执行统计
 */
export function getExecutionStats(taskId: string): { summary: ExecutionSummary; nodes: NodeExecutionStats[] } | null {
  const path = getStatsFilePath(taskId)
  if (!path || !existsSync(path)) {
    return null
  }

  return readJson(path, { defaultValue: null })
}

/**
 * 追加时间线事件
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
      hour12: false
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

// ============ 辅助函数 ============

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.round((ms % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.round((ms % 3600000) / 60000)
  return `${hours}h ${minutes}m`
}
