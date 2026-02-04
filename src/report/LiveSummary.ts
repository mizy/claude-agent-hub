/**
 * 实时任务摘要
 * 显示当前运行的任务状态和今日统计
 */

import { getRunningTasks, getQueuedTasks, getTodaySummary, getRecentCompleted } from './SummaryDataCollector.js'

// ============ 类型定义 ============

export interface RunningTaskInfo {
  taskId: string
  title: string
  status: string
  currentNode: string | null
  progress: {
    completed: number
    total: number
    percentage: number
  }
  startedAt: Date
  elapsedMs: number
  /** 预估剩余时间（毫秒） */
  estimatedRemainingMs?: number
  /** 预估置信度 (0-1) */
  estimateConfidence?: number
}

/** 待执行任务队列项 */
export interface QueuedTaskInfo {
  taskId: string
  title: string
  status: string
  createdAt: Date
  /** 预估执行时间（毫秒） */
  estimatedDurationMs?: number
}

export interface TodaySummary {
  date: string
  tasksCreated: number
  tasksCompleted: number
  tasksFailed: number
  tasksRunning: number
  totalDurationMs: number
  totalCostUsd: number
  avgSuccessRate: number
}

export interface LiveSummaryReport {
  generatedAt: string
  runningTasks: RunningTaskInfo[]
  /** 待执行任务队列 */
  queuedTasks: QueuedTaskInfo[]
  todaySummary: TodaySummary
  recentCompleted: Array<{
    taskId: string
    title: string
    status: string
    durationMs: number
    completedAt: string
  }>
  /** 预估全部任务完成时间 */
  estimatedAllCompletionTime?: string
}

// ============ 公开 API ============

/**
 * 生成实时摘要报告
 */
export function generateLiveSummary(): LiveSummaryReport {
  const runningTasks = getRunningTasks()
  const queuedTasks = getQueuedTasks()

  // 计算全部任务预估完成时间
  let estimatedAllCompletionTime: string | undefined
  const totalRemainingMs =
    runningTasks.reduce((sum, t) => sum + (t.estimatedRemainingMs || 60000), 0) +
    queuedTasks.reduce((sum, t) => sum + (t.estimatedDurationMs || 180000), 0)

  if (runningTasks.length > 0 || queuedTasks.length > 0) {
    const estimatedCompletion = new Date(Date.now() + totalRemainingMs)
    estimatedAllCompletionTime = estimatedCompletion.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    runningTasks,
    queuedTasks,
    todaySummary: getTodaySummary(),
    recentCompleted: getRecentCompleted(),
    estimatedAllCompletionTime,
  }
}

// 导出格式化函数
export { formatLiveSummaryForTerminal, formatLiveSummaryForJson } from './SummaryFormatter.js'
