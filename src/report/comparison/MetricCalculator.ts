/**
 * 指标计算器
 * 计算任务相似度和性能差异
 */

import { formatDuration } from '../../store/ExecutionStatsStore.js'
import type { TaskExecutionSnapshot, ComparisonResult } from './types.js'

/**
 * 计算两个任务的相似度 (0-1)
 */
export function calculateSimilarity(
  t1: TaskExecutionSnapshot,
  t2: TaskExecutionSnapshot
): number {
  // 同类型加权
  let score = t1.category === t2.category ? 0.4 : 0

  // 节点数接近加权
  const nodeDiff = Math.abs(t1.nodeCount - t2.nodeCount)
  if (nodeDiff === 0) score += 0.3
  else if (nodeDiff <= 2) score += 0.2
  else if (nodeDiff <= 4) score += 0.1

  // 节点名称重叠加权
  const commonNodes = t1.nodeNames.filter(n => t2.nodeNames.includes(n))
  const totalNodes = new Set([...t1.nodeNames, ...t2.nodeNames]).size
  if (totalNodes > 0) {
    score += (commonNodes.length / totalNodes) * 0.3
  }

  return score
}

/**
 * 对比两个任务
 */
export function compareTasks(
  t1: TaskExecutionSnapshot,
  t2: TaskExecutionSnapshot
): ComparisonResult {
  const durationDiffPercent =
    t1.durationMs > 0
      ? Math.round(((t2.durationMs - t1.durationMs) / t1.durationMs) * 100)
      : 0

  const costDiffPercent =
    t1.costUsd > 0
      ? Math.round(((t2.costUsd - t1.costUsd) / t1.costUsd) * 100)
      : 0

  const nodeCountDiff = t2.nodeCount - t1.nodeCount

  // 判断是否退化：时间增加 > 20% 或成本增加 > 30%
  const isRegression = durationDiffPercent > 20 || costDiffPercent > 30

  const analysis = generateAnalysis(
    t1,
    t2,
    durationDiffPercent,
    costDiffPercent,
    nodeCountDiff
  )

  return {
    task1: t1,
    task2: t2,
    durationDiffPercent,
    costDiffPercent,
    nodeCountDiff,
    isRegression,
    analysis,
  }
}

function generateAnalysis(
  t1: TaskExecutionSnapshot,
  t2: TaskExecutionSnapshot,
  durationDiffPercent: number,
  costDiffPercent: number,
  nodeCountDiff: number
): string[] {
  const analysis: string[] = []

  if (durationDiffPercent > 20) {
    analysis.push(
      `执行时间增加 ${durationDiffPercent}% (${formatDuration(t1.durationMs)} → ${formatDuration(t2.durationMs)})`
    )
  } else if (durationDiffPercent < -20) {
    analysis.push(
      `执行时间减少 ${-durationDiffPercent}% (${formatDuration(t1.durationMs)} → ${formatDuration(t2.durationMs)})`
    )
  }

  if (costDiffPercent > 30) {
    analysis.push(
      `成本增加 ${costDiffPercent}% ($${t1.costUsd.toFixed(4)} → $${t2.costUsd.toFixed(4)})`
    )
  } else if (costDiffPercent < -20) {
    analysis.push(`成本减少 ${-costDiffPercent}%`)
  }

  if (nodeCountDiff > 2) {
    analysis.push(`节点数增加 ${nodeCountDiff} 个`)
  } else if (nodeCountDiff < -2) {
    analysis.push(`节点数减少 ${-nodeCountDiff} 个`)
  }

  // 新增/移除的节点
  const addedNodes = t2.nodeNames.filter(n => !t1.nodeNames.includes(n))
  const removedNodes = t1.nodeNames.filter(n => !t2.nodeNames.includes(n))

  if (addedNodes.length > 0) {
    analysis.push(
      `新增节点: ${addedNodes.slice(0, 3).join(', ')}${addedNodes.length > 3 ? '...' : ''}`
    )
  }
  if (removedNodes.length > 0) {
    analysis.push(
      `移除节点: ${removedNodes.slice(0, 3).join(', ')}${removedNodes.length > 3 ? '...' : ''}`
    )
  }

  return analysis
}
