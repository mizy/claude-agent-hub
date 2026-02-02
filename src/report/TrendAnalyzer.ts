/**
 * 趋势分析器
 * 分析历史执行数据，生成性能趋势和成本分析
 */

// 重新导出所有类型
export type {
  TrendPeriod,
  CategoryStats,
  NodeCombination,
  CostOptimization,
  ExecutionTrend,
  NodePerformance,
  CostBreakdown,
  TrendReport,
} from './analyzers/types.js'

// 导入分析器
import {
  collectAllTaskStats,
  groupByPeriod,
  calculatePeriodTrend,
  analyzeNodePerformance,
  analyzeCostBreakdown,
  analyzeCategoryStats,
  analyzeNodeHeatmap,
  generateCostOptimizations,
  generateInsights,
} from './analyzers/index.js'

import type { TrendReport } from './analyzers/types.js'

// 重新导出格式化函数
export { formatTrendReportForTerminal, formatTrendReportForMarkdown } from './analyzers/formatters.js'

/**
 * 生成趋势报告
 */
export function generateTrendReport(
  daysBack: number = 30,
  periodType: 'day' | 'week' | 'month' = 'week'
): TrendReport | null {
  const allStats = collectAllTaskStats(daysBack)

  if (allStats.length === 0) {
    return null
  }

  const groups = groupByPeriod(allStats, periodType)
  const trends = []

  for (const [label, tasks] of groups.entries()) {
    let startDate: Date
    let endDate: Date

    switch (periodType) {
      case 'day':
        startDate = new Date(label)
        endDate = new Date(label)
        endDate.setDate(endDate.getDate() + 1)
        break
      case 'week':
        startDate = new Date(label)
        endDate = new Date(label)
        endDate.setDate(endDate.getDate() + 7)
        break
      case 'month':
        startDate = new Date(label + '-01')
        endDate = new Date(startDate)
        endDate.setMonth(endDate.getMonth() + 1)
        break
    }

    trends.push(calculatePeriodTrend(label, tasks, startDate, endDate))
  }

  const nodePerformance = analyzeNodePerformance(allStats)
  const costBreakdown = analyzeCostBreakdown(allStats)
  const categoryStats = analyzeCategoryStats(allStats)
  const nodeHeatmap = analyzeNodeHeatmap(allStats)
  const costOptimizations = generateCostOptimizations(allStats, nodePerformance, costBreakdown)
  const insights = generateInsights(trends, nodePerformance, costBreakdown)

  return {
    generatedAt: new Date().toISOString(),
    periodStart: allStats[0]!.createdAt,
    periodEnd: allStats[allStats.length - 1]!.createdAt,
    trends,
    nodePerformance,
    costBreakdown,
    insights,
    categoryStats,
    nodeHeatmap,
    costOptimizations,
  }
}
