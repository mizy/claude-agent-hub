/**
 * 退化检测器
 * 识别性能退化和改进
 */

import type { TaskExecutionSnapshot, ComparisonResult } from './types.js'
import { compareTasks, calculateSimilarity } from './MetricCalculator.js'

/** 性能退化报告 */
export interface RegressionReport {
  generatedAt: string
  /** 分析的任务数量 */
  analyzedTasks: number
  /** 检测到的退化 */
  regressions: ComparisonResult[]
  /** 性能改进 */
  improvements: ComparisonResult[]
  /** 按类型的趋势 */
  categoryTrends: Array<{
    category: string
    avgDurationChange: number
    avgCostChange: number
    sampleCount: number
  }>
  /** 总结 */
  summary: string[]
}

/**
 * 生成性能退化报告
 */
export function generateRegressionReport(snapshots: TaskExecutionSnapshot[]): RegressionReport {
  const regressions: ComparisonResult[] = []
  const improvements: ComparisonResult[] = []
  const categoryData = new Map<
    string,
    { totalDurationChange: number; totalCostChange: number; count: number }
  >()

  // 对相似任务进行对比
  for (let i = 0; i < snapshots.length; i++) {
    const t1 = snapshots[i]!
    // 找后续相似任务
    for (let j = i + 1; j < snapshots.length; j++) {
      const t2 = snapshots[j]!

      const similarity = calculateSimilarity(t1, t2)
      if (similarity < 0.5) continue // 相似度太低跳过

      const comparison = compareTasks(t1, t2)

      if (comparison.isRegression) {
        regressions.push(comparison)
      } else if (comparison.durationDiffPercent < -20 || comparison.costDiffPercent < -20) {
        improvements.push(comparison)
      }

      // 累计类型统计
      if (t1.category === t2.category) {
        const existing = categoryData.get(t1.category) || {
          totalDurationChange: 0,
          totalCostChange: 0,
          count: 0,
        }
        existing.totalDurationChange += comparison.durationDiffPercent
        existing.totalCostChange += comparison.costDiffPercent
        existing.count++
        categoryData.set(t1.category, existing)
      }
    }
  }

  // 生成类型趋势
  const categoryTrends = Array.from(categoryData.entries())
    .map(([category, data]) => ({
      category,
      avgDurationChange: data.count > 0 ? Math.round(data.totalDurationChange / data.count) : 0,
      avgCostChange: data.count > 0 ? Math.round(data.totalCostChange / data.count) : 0,
      sampleCount: data.count,
    }))
    .filter(t => t.sampleCount >= 2)
    .sort((a, b) => b.avgDurationChange - a.avgDurationChange)

  // 生成总结
  const summary = generateSummary(regressions, improvements, categoryTrends)

  return {
    generatedAt: new Date().toISOString(),
    analyzedTasks: snapshots.length,
    regressions: regressions.slice(0, 10),
    improvements: improvements.slice(0, 10),
    categoryTrends,
    summary,
  }
}

function generateSummary(
  regressions: ComparisonResult[],
  improvements: ComparisonResult[],
  categoryTrends: Array<{
    category: string
    avgDurationChange: number
    avgCostChange: number
  }>
): string[] {
  const summary: string[] = []

  if (regressions.length > 0) {
    summary.push(`检测到 ${regressions.length} 处性能退化`)
    const worstRegression = regressions.sort(
      (a, b) => b.durationDiffPercent - a.durationDiffPercent
    )[0]!
    summary.push(
      `最严重退化: ${worstRegression.task2.title} (时间 +${worstRegression.durationDiffPercent}%)`
    )
  }

  if (improvements.length > 0) {
    summary.push(`发现 ${improvements.length} 处性能改进`)
  }

  const slowingCategories = categoryTrends.filter(t => t.avgDurationChange > 10)
  if (slowingCategories.length > 0) {
    summary.push(
      `变慢的任务类型: ${slowingCategories.map(c => `${c.category}(+${c.avgDurationChange}%)`).join(', ')}`
    )
  }

  const improvingCategories = categoryTrends.filter(t => t.avgDurationChange < -10)
  if (improvingCategories.length > 0) {
    summary.push(
      `提速的任务类型: ${improvingCategories.map(c => `${c.category}(${c.avgDurationChange}%)`).join(', ')}`
    )
  }

  if (summary.length === 0) {
    summary.push('各项指标稳定，未检测到明显性能变化')
  }

  return summary
}
