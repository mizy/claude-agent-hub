/**
 * Collect task statistics from task store
 *
 * Reads all tasks via TaskStore and computes execution metrics.
 * Pure read-only — never modifies task data.
 */

import { getAllTasks } from '../store/TaskStore.js'
import { getExecutionStats } from '../store/ExecutionStatsStore.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { Task } from '../types/task.js'
import type { TaskStats, WeeklySuccessRate, HourDistribution } from './types.js'

const logger = createLogger('stats-task')

/** Get ISO week label from date: "2026-W10" */
function getISOWeekLabel(d: Date): string {
  const jan1 = new Date(d.getFullYear(), 0, 1)
  const weekNum = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

/** Build weekly success rate trend */
function buildWeeklyRates(tasks: Task[]): WeeklySuccessRate[] {
  const weekMap = new Map<string, { total: number; succeeded: number }>()

  for (const t of tasks) {
    if (t.status !== 'completed' && t.status !== 'failed') continue
    const week = getISOWeekLabel(new Date(t.createdAt))
    if (!weekMap.has(week)) weekMap.set(week, { total: 0, succeeded: 0 })
    const w = weekMap.get(week)!
    w.total++
    if (t.status === 'completed') w.succeeded++
  }

  return [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, { total, succeeded }]) => ({
      week,
      total,
      succeeded,
      rate: total > 0 ? Math.round((succeeded / total) * 1000) / 1000 : 0,
    }))
}

/** Count top N from a frequency map */
function topN(counter: Record<string, number>, n = 5): { name: string; count: number }[] {
  return Object.entries(counter)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([name, count]) => ({ name, count }))
}

/** Build peak hour distribution from task creation times */
function buildPeakHours(tasks: Task[]): HourDistribution[] {
  const counts = new Array(24).fill(0) as number[]
  for (const t of tasks) {
    const hour = new Date(t.createdAt).getHours()
    counts[hour]!++
  }
  return counts.map((count, hour) => ({ hour, count }))
}

/** @entry Collect all task statistics */
export function collectTaskStats(): TaskStats {
  let tasks: Task[]
  try {
    tasks = getAllTasks()
  } catch (error) {
    logger.warn(`Failed to read tasks: ${getErrorMessage(error)}`)
    tasks = []
  }

  const completed = tasks.filter(t => t.status === 'completed').length
  const failed = tasks.filter(t => t.status === 'failed').length
  const cancelled = tasks.filter(t => t.status === 'cancelled').length
  const pending = tasks.filter(t => t.status === 'pending').length
  const other = tasks.length - completed - failed - cancelled - pending

  // Average duration from completed tasks with output.timing
  const durations: number[] = []
  for (const t of tasks) {
    if (t.status === 'completed' && t.output?.timing) {
      const { startedAt, completedAt } = t.output.timing
      if (startedAt && completedAt) {
        const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
        if (ms > 0) durations.push(ms)
      }
    }
  }
  const avgDurationMs =
    durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

  // Count backends, models, agents (assignee)
  const backendCounter: Record<string, number> = {}
  const modelCounter: Record<string, number> = {}
  const agentCounter: Record<string, number> = {}

  for (const t of tasks) {
    if (t.backend) backendCounter[t.backend] = (backendCounter[t.backend] || 0) + 1
    if (t.model) modelCounter[t.model] = (modelCounter[t.model] || 0) + 1
    if (t.assignee) agentCounter[t.assignee] = (agentCounter[t.assignee] || 0) + 1
  }

  // Average node count from execution stats
  let totalNodes = 0
  let taskWithNodes = 0
  for (const t of tasks) {
    try {
      const stats = getExecutionStats(t.id)
      if (stats?.summary) {
        totalNodes += stats.summary.nodesTotal
        taskWithNodes++
      }
    } catch {
      // skip
    }
  }
  const avgNodeCount = taskWithNodes > 0 ? Math.round((totalNodes / taskWithNodes) * 10) / 10 : 0

  return {
    total: tasks.length,
    completed,
    failed,
    cancelled,
    pending,
    other,
    successRate:
      completed + failed > 0 ? Math.round((completed / (completed + failed)) * 1000) / 1000 : 0,
    weeklySuccessRates: buildWeeklyRates(tasks),
    avgDurationMs,
    topBackends: topN(backendCounter),
    topModels: topN(modelCounter),
    topAgents: topN(agentCounter),
    avgNodeCount,
    peakHours: buildPeakHours(tasks),
  }
}
