/**
 * Analyze task performance to extract efficiency patterns and improvement opportunities.
 *
 * Unlike analyzeFailures.ts (failure-only), this module examines both completed
 * and failed tasks for performance metrics: duration, cost, retries, bottleneck nodes.
 */

import { getTasksByStatus } from '../store/TaskStore.js'
import { getExecutionStats } from '../store/ExecutionStatsStore.js'
import { createLogger } from '../shared/logger.js'
import type { Task } from '../types/task.js'
import type { PerformanceMetrics, PerformancePattern, PerformanceAnalysis } from './types.js'

const logger = createLogger('selfevolve:perf')

interface AnalyzeOptions {
  /** Max tasks to analyze (default: 50) */
  limit?: number
  /** Only analyze tasks created after this date */
  since?: Date
  /** Include completed tasks (default: true) */
  includeCompleted?: boolean
  /** Include failed tasks (default: true) */
  includeFailed?: boolean
}

/**
 * Analyze recent task performance and detect patterns.
 *
 * Reads stats.json for each task to extract duration, cost, node-level metrics.
 * Detects slow execution, high cost, excessive retries, and bottleneck nodes.
 */
export function analyzePerformance(options?: AnalyzeOptions): PerformanceAnalysis {
  const limit = options?.limit ?? 50
  const since = options?.since
  const includeCompleted = options?.includeCompleted ?? true
  const includeFailed = options?.includeFailed ?? true

  // Collect tasks
  const tasks: Task[] = []
  if (includeCompleted) tasks.push(...getTasksByStatus('completed'))
  if (includeFailed) tasks.push(...getTasksByStatus('failed'))

  // Filter by date and limit
  let filtered = tasks
  if (since) {
    const sinceMs = since.getTime()
    filtered = filtered.filter(t => {
      const created = t.createdAt ? new Date(t.createdAt).getTime() : 0
      return created >= sinceMs
    })
  }
  // Take most recent tasks
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  filtered = filtered.slice(0, limit)

  if (filtered.length === 0) {
    logger.info('No tasks found for performance analysis')
    return emptyAnalysis()
  }

  logger.info(`Analyzing performance of ${filtered.length} tasks`)

  // Extract metrics for each task
  const allMetrics: PerformanceMetrics[] = []
  for (const task of filtered) {
    const metrics = extractMetrics(task)
    if (metrics) allMetrics.push(metrics)
  }

  if (allMetrics.length === 0) {
    logger.info('No stats data available for any tasks')
    return emptyAnalysis()
  }

  // Compute aggregates
  const completedMetrics = allMetrics.filter(m => m.status === 'completed')
  const totalDuration = allMetrics.reduce((s, m) => s + m.totalDurationMs, 0)
  const totalCost = allMetrics.reduce((s, m) => s + m.totalCostUsd, 0)
  const avgDurationMs = Math.round(totalDuration / allMetrics.length)
  const avgCostUsd = totalCost / allMetrics.length
  const successRate = allMetrics.length > 0 ? completedMetrics.length / allMetrics.length : 0

  // Detect patterns
  const patterns: PerformancePattern[] = []
  detectSlowExecution(allMetrics, avgDurationMs, patterns)
  detectHighCost(allMetrics, avgCostUsd, patterns)
  detectExcessiveRetries(allMetrics, patterns)
  detectBottleneckNodes(allMetrics, patterns)

  // Compute node hotspots
  const nodeHotspots = computeNodeHotspots(allMetrics)

  logger.info(
    `Performance analysis: ${allMetrics.length} tasks, ${patterns.length} patterns, avg ${Math.round(avgDurationMs / 1000)}s`
  )

  return {
    totalExamined: allMetrics.length,
    avgDurationMs,
    avgCostUsd,
    successRate,
    patterns,
    nodeHotspots,
  }
}

/** Extract performance metrics from a single task's stats.json */
function extractMetrics(task: Task): PerformanceMetrics | null {
  const stats = getExecutionStats(task.id)
  if (!stats) return null

  const { summary, nodes } = stats

  // Find the slowest node
  let maxNodeDurationMs = 0
  let maxNodeName = ''
  let retryCount = 0

  for (const node of nodes) {
    if (node.durationMs && node.durationMs > maxNodeDurationMs) {
      maxNodeDurationMs = node.durationMs
      maxNodeName = node.nodeName
    }
    // Retries = attempts beyond the first
    if (node.attempts > 1) {
      retryCount += node.attempts - 1
    }
  }

  return {
    taskId: task.id,
    status: task.status === 'completed' ? 'completed' : 'failed',
    totalDurationMs: summary.totalDurationMs,
    totalCostUsd: summary.totalCostUsd,
    nodeCount: summary.nodesTotal,
    avgNodeDurationMs: summary.avgNodeDurationMs,
    maxNodeDurationMs,
    maxNodeName,
    retryCount,
    failedNodeCount: summary.nodesFailed,
  }
}

/** Detect tasks with abnormally slow execution (> 2x average) */
function detectSlowExecution(
  metrics: PerformanceMetrics[],
  avgDurationMs: number,
  patterns: PerformancePattern[]
): void {
  const threshold = avgDurationMs * 2
  if (threshold === 0) return

  const slowTasks = metrics.filter(m => m.totalDurationMs > threshold)
  if (slowTasks.length === 0) return

  const maxDuration = Math.max(...slowTasks.map(m => m.totalDurationMs))
  const severity = maxDuration > threshold * 2 ? 'critical' : 'warning'

  patterns.push({
    category: 'slow_execution',
    description: `${slowTasks.length} tasks took over 2x average duration (>${Math.round(threshold / 1000)}s)`,
    severity,
    metric: 'totalDurationMs',
    value: maxDuration,
    threshold,
    taskIds: slowTasks.map(m => m.taskId),
    suggestion: 'Consider breaking large tasks into smaller subtasks or optimizing slow workflow nodes',
  })
}

/** Detect tasks with abnormally high cost (> 2x average) */
function detectHighCost(
  metrics: PerformanceMetrics[],
  avgCostUsd: number,
  patterns: PerformancePattern[]
): void {
  const threshold = avgCostUsd * 2
  if (threshold === 0) return

  const expensiveTasks = metrics.filter(m => m.totalCostUsd > threshold)
  if (expensiveTasks.length === 0) return

  const maxCost = Math.max(...expensiveTasks.map(m => m.totalCostUsd))
  const severity = maxCost > threshold * 2 ? 'critical' : 'warning'

  patterns.push({
    category: 'high_cost',
    description: `${expensiveTasks.length} tasks cost over 2x average ($${threshold.toFixed(4)})`,
    severity,
    metric: 'totalCostUsd',
    value: maxCost,
    threshold,
    taskIds: expensiveTasks.map(m => m.taskId),
    suggestion: 'Review prompts for verbosity, reduce unnecessary context, or simplify workflow structure',
  })
}

/** Detect tasks with excessive retries (> 3 total retries) */
function detectExcessiveRetries(
  metrics: PerformanceMetrics[],
  patterns: PerformancePattern[]
): void {
  const threshold = 3
  const retryTasks = metrics.filter(m => m.retryCount > threshold)
  if (retryTasks.length === 0) return

  const maxRetries = Math.max(...retryTasks.map(m => m.retryCount))
  const severity = maxRetries > 6 ? 'critical' : 'warning'

  patterns.push({
    category: 'excessive_retries',
    description: `${retryTasks.length} tasks had more than ${threshold} retries`,
    severity,
    metric: 'retryCount',
    value: maxRetries,
    threshold,
    taskIds: retryTasks.map(m => m.taskId),
    suggestion: 'Improve prompt clarity or add better error handling to reduce node failures',
  })
}

/** Detect bottleneck nodes (single node > 70% of total task time) */
function detectBottleneckNodes(
  metrics: PerformanceMetrics[],
  patterns: PerformancePattern[]
): void {
  const bottleneckRatio = 0.7
  const bottleneckTasks = metrics.filter(
    m => m.totalDurationMs > 0 && m.maxNodeDurationMs / m.totalDurationMs > bottleneckRatio
  )
  if (bottleneckTasks.length === 0) return

  // Group by bottleneck node name
  const nodeGroups = new Map<string, string[]>()
  for (const m of bottleneckTasks) {
    const ids = nodeGroups.get(m.maxNodeName) ?? []
    ids.push(m.taskId)
    nodeGroups.set(m.maxNodeName, ids)
  }

  for (const [nodeName, taskIds] of nodeGroups) {
    const worstTask = bottleneckTasks.find(m => m.maxNodeName === nodeName)!
    const ratio = worstTask.maxNodeDurationMs / worstTask.totalDurationMs

    patterns.push({
      category: 'bottleneck_node',
      description: `Node "${nodeName}" takes >${Math.round(ratio * 100)}% of execution time in ${taskIds.length} tasks`,
      severity: ratio > 0.85 ? 'critical' : 'warning',
      metric: 'maxNodeDurationRatio',
      value: ratio,
      threshold: bottleneckRatio,
      taskIds,
      suggestion: `Consider splitting node "${nodeName}" into smaller steps or optimizing its prompt`,
    })
  }
}

/** Compute node hotspots: aggregate by node name, sorted by avg duration */
function computeNodeHotspots(
  metrics: PerformanceMetrics[]
): Array<{ nodeName: string; avgDurationMs: number; occurrences: number }> {
  // We only have max node info per task; for more detailed hotspots we read stats nodes
  const nodeMap = new Map<string, { totalMs: number; count: number }>()

  for (const m of metrics) {
    if (!m.maxNodeName || m.maxNodeDurationMs === 0) continue
    const entry = nodeMap.get(m.maxNodeName) ?? { totalMs: 0, count: 0 }
    entry.totalMs += m.maxNodeDurationMs
    entry.count++
    nodeMap.set(m.maxNodeName, entry)
  }

  return Array.from(nodeMap.entries())
    .map(([nodeName, { totalMs, count }]) => ({
      nodeName,
      avgDurationMs: Math.round(totalMs / count),
      occurrences: count,
    }))
    .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
    .slice(0, 10) // top 10
}

function emptyAnalysis(): PerformanceAnalysis {
  return {
    totalExamined: 0,
    avgDurationMs: 0,
    avgCostUsd: 0,
    successRate: 0,
    patterns: [],
    nodeHotspots: [],
  }
}
