/**
 * 成本分析器
 * 分析成本分布和生成优化建议
 */

import type { TaskCategory } from '../../analysis/index.js'
import type { TaskStats, CostBreakdown, CostOptimization, NodePerformance } from './types.js'

/**
 * 分析成本分布
 */
export function analyzeCostBreakdown(stats: TaskStats[]): CostBreakdown {
  let totalCostUsd = 0
  const byDate = new Map<string, number>()
  const byNodeType = new Map<string, number>()
  let totalTasks = 0
  let totalNodes = 0

  for (const task of stats) {
    totalCostUsd += task.summary.totalCostUsd
    totalTasks++
    totalNodes += task.summary.nodesTotal

    // 按日期统计
    const dateKey = task.createdAt.toISOString().slice(0, 10)
    byDate.set(dateKey, (byDate.get(dateKey) || 0) + task.summary.totalCostUsd)

    // 按节点类型统计
    for (const node of task.nodes) {
      if (node.costUsd) {
        byNodeType.set(node.nodeType, (byNodeType.get(node.nodeType) || 0) + node.costUsd)
      }
    }
  }

  return {
    totalCostUsd,
    byDate: Array.from(byDate.entries())
      .map(([date, costUsd]) => ({ date, costUsd }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byNodeType: Array.from(byNodeType.entries())
      .map(([nodeType, costUsd]) => ({
        nodeType,
        costUsd,
        percentage: totalCostUsd > 0 ? Math.round((costUsd / totalCostUsd) * 100) : 0,
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
    avgCostPerTask: totalTasks > 0 ? totalCostUsd / totalTasks : 0,
    avgCostPerNode: totalNodes > 0 ? totalCostUsd / totalNodes : 0,
  }
}

/**
 * 生成成本优化建议
 */
export function generateCostOptimizations(
  stats: TaskStats[],
  nodePerformance: NodePerformance[],
  costBreakdown: CostBreakdown
): CostOptimization[] {
  const optimizations: CostOptimization[] = []

  // 1. 高成本节点建议
  const avgCostPerNode = costBreakdown.avgCostPerNode
  const highCostNodes = nodePerformance.filter(
    n => n.totalCostUsd / n.executionCount > avgCostPerNode * 2 && n.executionCount >= 2
  )
  if (highCostNodes.length > 0) {
    const topExpensive = highCostNodes.slice(0, 3)
    const potentialSaving = topExpensive.reduce(
      (sum, n) =>
        sum + (n.totalCostUsd / n.executionCount - avgCostPerNode) * n.executionCount * 0.5,
      0
    )
    optimizations.push({
      type: 'high_cost_node',
      suggestion: `以下节点成本高于平均水平 2 倍以上，考虑优化 prompt 或拆分任务: ${topExpensive.map(n => n.nodeName).join(', ')}`,
      potentialSavingUsd: potentialSaving,
      affectedItems: topExpensive.map(n => n.nodeName),
    })
  }

  // 2. 重试浪费建议
  let totalRetryWaste = 0
  const retriedTasks: string[] = []
  for (const task of stats) {
    const failedNodes = task.nodes.filter(n => n.status === 'failed')
    for (const node of failedNodes) {
      if (node.costUsd) {
        totalRetryWaste += node.costUsd
        if (!retriedTasks.includes(task.taskId)) {
          retriedTasks.push(task.taskId)
        }
      }
    }
  }
  if (totalRetryWaste > 0.01) {
    optimizations.push({
      type: 'retry_waste',
      suggestion: `失败重试造成的浪费: $${totalRetryWaste.toFixed(4)}。考虑在 workflow 生成时添加更明确的前置条件检查`,
      potentialSavingUsd: totalRetryWaste * 0.7, // 假设可以减少 70%
      affectedItems: retriedTasks.slice(0, 5),
    })
  }

  // 3. 冗余节点建议
  const lowSuccessNodes = nodePerformance.filter(n => n.successRate < 50 && n.executionCount >= 3)
  if (lowSuccessNodes.length > 0) {
    optimizations.push({
      type: 'redundant_nodes',
      suggestion: `以下节点成功率低于 50%，可能是任务设计不合理: ${lowSuccessNodes.map(n => `${n.nodeName}(${n.successRate}%)`).join(', ')}`,
      potentialSavingUsd: lowSuccessNodes.reduce((sum, n) => sum + n.totalCostUsd * 0.3, 0),
      affectedItems: lowSuccessNodes.map(n => n.nodeName),
    })
  }

  // 4. 批量处理机会
  const sameCategoryTasks = new Map<TaskCategory, number>()
  for (const task of stats) {
    const cat = task.category || 'other'
    sameCategoryTasks.set(cat, (sameCategoryTasks.get(cat) || 0) + 1)
  }
  const batchableTasks = Array.from(sameCategoryTasks.entries()).filter(
    ([cat, count]) => count >= 5 && (cat === 'git' || cat === 'docs')
  )
  if (batchableTasks.length > 0) {
    const totalBatchable = batchableTasks.reduce((sum, [, count]) => sum + count, 0)
    optimizations.push({
      type: 'batch_opportunity',
      suggestion: `${batchableTasks.map(([cat]) => cat).join('/')} 类型任务较多，考虑批量处理以减少 overhead`,
      potentialSavingUsd: costBreakdown.avgCostPerTask * totalBatchable * 0.2,
      affectedItems: batchableTasks.map(([cat, count]) => `${cat}(${count}个)`),
    })
  }

  return optimizations.sort((a, b) => b.potentialSavingUsd - a.potentialSavingUsd)
}

/**
 * 生成洞察
 */
export function generateInsights(
  trends: {
    period: { label: string }
    successRate: number
    avgDurationMs: number
    failureReasons: { reason: string; count: number }[]
  }[],
  nodePerformance: NodePerformance[],
  costBreakdown: CostBreakdown
): string[] {
  const insights: string[] = []

  // 成功率趋势
  if (trends.length >= 2) {
    const recent = trends[trends.length - 1]!
    const previous = trends[trends.length - 2]!
    const diff = recent.successRate - previous.successRate

    if (diff > 10) {
      insights.push(`成功率显著提升: ${previous.successRate}% → ${recent.successRate}% (+${diff}%)`)
    } else if (diff < -10) {
      insights.push(`⚠️ 成功率下降: ${previous.successRate}% → ${recent.successRate}% (${diff}%)`)
    }

    // 执行时间趋势
    if (previous.avgDurationMs > 0) {
      const change =
        ((recent.avgDurationMs - previous.avgDurationMs) / previous.avgDurationMs) * 100

      if (change > 30) {
        insights.push(`⚠️ 平均执行时间增加 ${Math.round(change)}%`)
      } else if (change < -30) {
        insights.push(`执行效率提升: 平均时间减少 ${Math.round(-change)}%`)
      }
    }
  }

  // 高失败率节点
  const failingNodes = nodePerformance.filter(n => n.successRate < 80 && n.executionCount >= 3)
  if (failingNodes.length > 0) {
    const nodeNames = failingNodes
      .slice(0, 3)
      .map(n => n.nodeName)
      .join(', ')
    insights.push(`⚠️ 需要关注的节点 (成功率<80%): ${nodeNames}`)
  }

  // 成本分布
  const topCostNode = costBreakdown.byNodeType[0]
  if (topCostNode && topCostNode.percentage > 50) {
    insights.push(`成本集中在 ${topCostNode.nodeType} 节点 (${topCostNode.percentage}% of total)`)
  }

  // 常见失败原因
  const allFailures = new Map<string, number>()
  for (const trend of trends) {
    for (const f of trend.failureReasons) {
      allFailures.set(f.reason, (allFailures.get(f.reason) || 0) + f.count)
    }
  }
  const topFailures = Array.from(allFailures.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)

  if (topFailures.length > 0) {
    insights.push(`常见失败原因: ${topFailures.map(([r, c]) => `${r} (${c}次)`).join(', ')}`)
  }

  if (insights.length === 0) {
    insights.push('各项指标稳定，无明显异常')
  }

  return insights
}
