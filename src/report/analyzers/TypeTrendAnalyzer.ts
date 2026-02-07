/**
 * 类型趋势分析器
 * 分析执行趋势和任务类型统计
 */

import type { TaskCategory } from '../../analysis/index.js'
import type { TaskStats, ExecutionTrend, CategoryStats, NodePerformance } from './types.js'

/**
 * 计算单个周期的趋势数据
 */
export function calculatePeriodTrend(
  label: string,
  tasks: TaskStats[],
  startDate: Date,
  endDate: Date
): ExecutionTrend {
  const taskCount = tasks.length
  let successCount = 0
  let totalDurationMs = 0
  let totalCostUsd = 0
  let totalNodes = 0
  const failureReasons = new Map<string, number>()

  for (const task of tasks) {
    if (task.summary.status === 'completed') {
      successCount++
    } else if (task.summary.status === 'failed') {
      // 分析失败原因
      const failedNodes = task.nodes.filter(n => n.status === 'failed')
      for (const node of failedNodes) {
        const reason = node.error?.slice(0, 50) || 'Unknown error'
        failureReasons.set(reason, (failureReasons.get(reason) || 0) + 1)
      }
    }

    totalDurationMs += task.summary.totalDurationMs
    totalCostUsd += task.summary.totalCostUsd
    totalNodes += task.summary.nodesTotal
  }

  const successRate = taskCount > 0 ? Math.round((successCount / taskCount) * 100) : 0
  const avgDurationMs = taskCount > 0 ? Math.round(totalDurationMs / taskCount) : 0
  const avgNodesPerTask = taskCount > 0 ? Math.round(totalNodes / taskCount) : 0

  // 按出现次数排序失败原因
  const sortedFailures = Array.from(failureReasons.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    period: { label, startDate, endDate },
    taskCount,
    successRate,
    avgDurationMs,
    totalCostUsd,
    avgNodesPerTask,
    failureReasons: sortedFailures,
  }
}

/**
 * 分析节点性能
 */
export function analyzeNodePerformance(stats: TaskStats[]): NodePerformance[] {
  const nodeMap = new Map<
    string,
    {
      nodeName: string
      nodeType: string
      executions: number
      successes: number
      totalDurationMs: number
      totalCostUsd: number
    }
  >()

  for (const task of stats) {
    for (const node of task.nodes) {
      const key = `${node.nodeType}:${node.nodeName}`
      if (!nodeMap.has(key)) {
        nodeMap.set(key, {
          nodeName: node.nodeName,
          nodeType: node.nodeType,
          executions: 0,
          successes: 0,
          totalDurationMs: 0,
          totalCostUsd: 0,
        })
      }

      const data = nodeMap.get(key)!
      data.executions++
      if (node.status === 'completed') {
        data.successes++
      }
      if (node.durationMs) data.totalDurationMs += node.durationMs
      if (node.costUsd) data.totalCostUsd += node.costUsd
    }
  }

  return Array.from(nodeMap.values())
    .map(data => ({
      nodeName: data.nodeName,
      nodeType: data.nodeType,
      executionCount: data.executions,
      avgDurationMs: data.executions > 0 ? Math.round(data.totalDurationMs / data.executions) : 0,
      successRate: data.executions > 0 ? Math.round((data.successes / data.executions) * 100) : 0,
      totalCostUsd: data.totalCostUsd,
    }))
    .sort((a, b) => b.executionCount - a.executionCount)
}

/**
 * 分析任务类型统计
 */
export function analyzeCategoryStats(stats: TaskStats[]): CategoryStats[] {
  const categoryMap = new Map<
    TaskCategory,
    {
      taskCount: number
      successCount: number
      totalDurationMs: number
      totalCostUsd: number
      totalNodeCount: number
    }
  >()

  for (const task of stats) {
    const cat = task.category || 'other'
    const existing = categoryMap.get(cat) || {
      taskCount: 0,
      successCount: 0,
      totalDurationMs: 0,
      totalCostUsd: 0,
      totalNodeCount: 0,
    }

    existing.taskCount++
    if (task.summary.status === 'completed') {
      existing.successCount++
    }
    existing.totalDurationMs += task.summary.totalDurationMs
    existing.totalCostUsd += task.summary.totalCostUsd
    existing.totalNodeCount += task.summary.nodesTotal

    categoryMap.set(cat, existing)
  }

  return Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category,
      taskCount: data.taskCount,
      successRate: data.taskCount > 0 ? Math.round((data.successCount / data.taskCount) * 100) : 0,
      avgDurationMs: data.taskCount > 0 ? Math.round(data.totalDurationMs / data.taskCount) : 0,
      totalCostUsd: data.totalCostUsd,
      avgNodeCount: data.taskCount > 0 ? Math.round(data.totalNodeCount / data.taskCount) : 0,
    }))
    .sort((a, b) => b.taskCount - a.taskCount)
}
