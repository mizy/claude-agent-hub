/**
 * 趋势分析器
 * 分析历史执行数据，生成性能趋势和成本分析
 */

import { readdirSync, existsSync, readFileSync } from 'fs'
import { TASKS_DIR } from '../store/paths.js'
import { readJson } from '../store/json.js'
import { formatDuration } from '../store/ExecutionStatsStore.js'
import type { ExecutionSummary, ExecutionTimeline } from '../store/ExecutionStatsStore.js'
import type { NodeExecutionStats } from '../workflow/engine/WorkflowEventEmitter.js'
import type { TaskCategory } from '../agent/executionHistory.js'

// ============ 类型定义 ============

export interface TrendPeriod {
  label: string
  startDate: Date
  endDate: Date
}

/** 任务类型统计 */
export interface CategoryStats {
  category: TaskCategory
  taskCount: number
  successRate: number
  avgDurationMs: number
  totalCostUsd: number
  avgNodeCount: number
}

/** 节点组合热力图数据 */
export interface NodeCombination {
  /** 节点组合 (如 "分析代码 → 实现功能") */
  combination: string
  /** 出现次数 */
  count: number
  /** 成功率 */
  successRate: number
  /** 平均执行时间 */
  avgDurationMs: number
}

/** 成本优化建议 */
export interface CostOptimization {
  /** 优化类型 */
  type: 'high_cost_node' | 'redundant_nodes' | 'batch_opportunity' | 'retry_waste'
  /** 建议描述 */
  suggestion: string
  /** 潜在节省金额 */
  potentialSavingUsd: number
  /** 影响的节点或任务 */
  affectedItems: string[]
}

export interface ExecutionTrend {
  period: TrendPeriod
  taskCount: number
  successRate: number
  avgDurationMs: number
  totalCostUsd: number
  avgNodesPerTask: number
  failureReasons: { reason: string; count: number }[]
  /** 按类型分布 */
  categoryBreakdown?: { category: TaskCategory; count: number }[]
}

export interface NodePerformance {
  nodeName: string
  nodeType: string
  executionCount: number
  avgDurationMs: number
  successRate: number
  totalCostUsd: number
}

export interface CostBreakdown {
  totalCostUsd: number
  byDate: { date: string; costUsd: number }[]
  byNodeType: { nodeType: string; costUsd: number; percentage: number }[]
  avgCostPerTask: number
  avgCostPerNode: number
}

export interface TrendReport {
  generatedAt: string
  periodStart: Date
  periodEnd: Date
  trends: ExecutionTrend[]
  nodePerformance: NodePerformance[]
  costBreakdown: CostBreakdown
  insights: string[]
  /** 按任务类型的统计 */
  categoryStats: CategoryStats[]
  /** 节点组合热力图 */
  nodeHeatmap: NodeCombination[]
  /** 成本优化建议 */
  costOptimizations: CostOptimization[]
}

// ============ 数据收集 ============

interface TaskStats {
  taskId: string
  createdAt: Date
  summary: ExecutionSummary
  nodes: NodeExecutionStats[]
  timeline: ExecutionTimeline[]
  /** 任务类型 */
  category?: TaskCategory
  /** 节点名称序列 */
  nodeNames?: string[]
}

/**
 * 任务类型分类（简化版，与 executionHistory 保持一致）
 */
function categorizeTask(title: string, description?: string): TaskCategory {
  const text = `${title} ${description || ''}`.toLowerCase()

  if (/commit|push|pull|merge|提交|推送|合并/.test(text)) return 'git'
  if (/迭代|进化|iteration|evolution|cycle|周期/.test(text)) return 'iteration'
  if (/refactor|重构|优化|整理|reorganize/.test(text)) return 'refactor'
  if (/fix|bug|修复|修正|repair/.test(text)) return 'fix'
  if (/test|测试|spec|unittest/.test(text)) return 'test'
  if (/doc|文档|readme|changelog/.test(text)) return 'docs'
  if (/add|feature|implement|新增|添加|实现|功能/.test(text)) return 'feature'

  return 'other'
}

/**
 * 读取所有任务统计数据
 */
function collectAllTaskStats(daysBack: number = 30): TaskStats[] {
  if (!existsSync(TASKS_DIR)) {
    return []
  }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)

  const taskFolders = readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('task-'))
    .map(d => d.name)

  const stats: TaskStats[] = []

  for (const folder of taskFolders) {
    const taskPath = `${TASKS_DIR}/${folder}`
    const statsPath = `${taskPath}/stats.json`
    const timelinePath = `${taskPath}/timeline.json`
    const taskJsonPath = `${taskPath}/task.json`
    const workflowPath = `${taskPath}/workflow.json`

    if (!existsSync(statsPath)) continue

    // 读取任务信息
    const taskJson = existsSync(taskJsonPath)
      ? readJson<{ createdAt: string; title?: string; description?: string }>(taskJsonPath, { defaultValue: null })
      : null
    if (!taskJson?.createdAt) continue

    const createdAt = new Date(taskJson.createdAt)
    if (createdAt < cutoffDate) continue

    // 读取统计数据
    const statsData = readJson<{ summary: ExecutionSummary; nodes: NodeExecutionStats[] }>(statsPath, { defaultValue: null })
    if (!statsData?.summary) continue

    // 读取时间线
    const timeline = existsSync(timelinePath)
      ? readJson<ExecutionTimeline[]>(timelinePath, { defaultValue: [] }) ?? []
      : []

    // 任务分类
    const category = categorizeTask(taskJson.title || '', taskJson.description)

    // 读取节点名称序列
    let nodeNames: string[] | undefined
    if (existsSync(workflowPath)) {
      try {
        const workflow = JSON.parse(readFileSync(workflowPath, 'utf-8'))
        if (workflow.nodes && Array.isArray(workflow.nodes)) {
          nodeNames = workflow.nodes
            .filter((n: { type?: string }) => n.type === 'task')
            .map((n: { name?: string }) => n.name || 'unnamed')
        }
      } catch {
        // ignore
      }
    }

    stats.push({
      taskId: folder,
      createdAt,
      summary: statsData.summary,
      nodes: statsData.nodes || [],
      timeline,
      category,
      nodeNames,
    })
  }

  // 按创建时间排序
  return stats.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

// ============ 趋势分析 ============

/**
 * 按周期分组任务
 */
function groupByPeriod(
  stats: TaskStats[],
  periodType: 'day' | 'week' | 'month'
): Map<string, TaskStats[]> {
  const groups = new Map<string, TaskStats[]>()

  for (const stat of stats) {
    let key: string
    const date = stat.createdAt

    switch (periodType) {
      case 'day':
        key = date.toISOString().slice(0, 10)
        break
      case 'week': {
        const startOfWeek = new Date(date)
        startOfWeek.setDate(date.getDate() - date.getDay())
        key = startOfWeek.toISOString().slice(0, 10)
        break
      }
      case 'month':
        key = date.toISOString().slice(0, 7)
        break
    }

    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(stat)
  }

  return groups
}

/**
 * 计算单个周期的趋势数据
 */
function calculatePeriodTrend(
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
function analyzeNodePerformance(stats: TaskStats[]): NodePerformance[] {
  const nodeMap = new Map<string, {
    nodeName: string
    nodeType: string
    executions: number
    successes: number
    totalDurationMs: number
    totalCostUsd: number
  }>()

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
 * 分析成本分布
 */
function analyzeCostBreakdown(stats: TaskStats[]): CostBreakdown {
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
 * 分析任务类型统计
 */
function analyzeCategoryStats(stats: TaskStats[]): CategoryStats[] {
  const categoryMap = new Map<TaskCategory, {
    taskCount: number
    successCount: number
    totalDurationMs: number
    totalCostUsd: number
    totalNodeCount: number
  }>()

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

/**
 * 分析节点组合热力图
 * 统计相邻节点的组合频率和成功率
 */
function analyzeNodeHeatmap(stats: TaskStats[]): NodeCombination[] {
  const combinationMap = new Map<string, {
    count: number
    successCount: number
    totalDurationMs: number
  }>()

  for (const task of stats) {
    const nodeNames = task.nodeNames
    if (!nodeNames || nodeNames.length < 2) continue

    const isSuccess = task.summary.status === 'completed'

    // 统计相邻节点对
    for (let i = 0; i < nodeNames.length - 1; i++) {
      const combo = `${nodeNames[i]} → ${nodeNames[i + 1]}`
      const existing = combinationMap.get(combo) || { count: 0, successCount: 0, totalDurationMs: 0 }
      existing.count++
      if (isSuccess) existing.successCount++

      // 统计这两个节点的执行时间
      const node1 = task.nodes.find(n => n.nodeName === nodeNames[i])
      const node2 = task.nodes.find(n => n.nodeName === nodeNames[i + 1])
      if (node1?.durationMs) existing.totalDurationMs += node1.durationMs
      if (node2?.durationMs) existing.totalDurationMs += node2.durationMs

      combinationMap.set(combo, existing)
    }
  }

  return Array.from(combinationMap.entries())
    .map(([combination, data]) => ({
      combination,
      count: data.count,
      successRate: data.count > 0 ? Math.round((data.successCount / data.count) * 100) : 0,
      avgDurationMs: data.count > 0 ? Math.round(data.totalDurationMs / data.count / 2) : 0,
    }))
    .filter(c => c.count >= 2) // 至少出现 2 次
    .sort((a, b) => b.count - a.count)
    .slice(0, 15) // 取前 15 个最常见的组合
}

/**
 * 生成成本优化建议
 */
function generateCostOptimizations(
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
      (sum, n) => sum + (n.totalCostUsd / n.executionCount - avgCostPerNode) * n.executionCount * 0.5,
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
  const batchableTasks = Array.from(sameCategoryTasks.entries())
    .filter(([cat, count]) => count >= 5 && (cat === 'git' || cat === 'docs'))
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
function generateInsights(
  trends: ExecutionTrend[],
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
      const change = ((recent.avgDurationMs - previous.avgDurationMs) / previous.avgDurationMs) * 100

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
    const nodeNames = failingNodes.slice(0, 3).map(n => n.nodeName).join(', ')
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

// ============ 公开 API ============

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
  const trends: ExecutionTrend[] = []

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

// ============ 格式化输出 ============

/**
 * 格式化趋势报告为终端输出
 */
export function formatTrendReportForTerminal(report: TrendReport): string {
  const lines: string[] = []

  lines.push('═'.repeat(60))
  lines.push('  趋势分析报告')
  lines.push('═'.repeat(60))
  lines.push('')

  // 洞察
  lines.push('【关键洞察】')
  for (const insight of report.insights) {
    lines.push(`  • ${insight}`)
  }
  lines.push('')

  // 周期趋势
  lines.push('【执行趋势】')
  lines.push('  周期         任务数  成功率  平均耗时    成本')
  lines.push('  ' + '-'.repeat(55))
  for (const trend of report.trends) {
    const label = trend.period.label.padEnd(12)
    const count = String(trend.taskCount).padStart(5)
    const rate = `${trend.successRate}%`.padStart(6)
    const duration = formatDuration(trend.avgDurationMs).padStart(10)
    const cost = `$${trend.totalCostUsd.toFixed(2)}`.padStart(8)
    lines.push(`  ${label} ${count}  ${rate}  ${duration}  ${cost}`)
  }
  lines.push('')

  // 节点性能 (前5)
  if (report.nodePerformance.length > 0) {
    lines.push('【节点性能 Top 5】')
    lines.push('  节点名称                   执行数  成功率  平均耗时')
    lines.push('  ' + '-'.repeat(55))
    for (const node of report.nodePerformance.slice(0, 5)) {
      const name = node.nodeName.slice(0, 24).padEnd(24)
      const count = String(node.executionCount).padStart(6)
      const rate = `${node.successRate}%`.padStart(6)
      const duration = formatDuration(node.avgDurationMs).padStart(10)
      lines.push(`  ${name} ${count}  ${rate}  ${duration}`)
    }
    lines.push('')
  }

  // 成本分布
  lines.push('【成本分布】')
  lines.push(`  总成本: $${report.costBreakdown.totalCostUsd.toFixed(4)}`)
  lines.push(`  平均每任务: $${report.costBreakdown.avgCostPerTask.toFixed(4)}`)
  lines.push(`  平均每节点: $${report.costBreakdown.avgCostPerNode.toFixed(6)}`)
  lines.push('')

  if (report.costBreakdown.byNodeType.length > 0) {
    lines.push('  按节点类型:')
    for (const item of report.costBreakdown.byNodeType.slice(0, 5)) {
      const bar = '█'.repeat(Math.round(item.percentage / 5))
      lines.push(`    ${item.nodeType}: ${bar} ${item.percentage}% ($${item.costUsd.toFixed(4)})`)
    }
  }
  lines.push('')

  // 任务类型统计
  if (report.categoryStats.length > 0) {
    lines.push('【任务类型分布】')
    lines.push('  类型       任务数  成功率  平均耗时   平均节点')
    lines.push('  ' + '-'.repeat(50))
    for (const cat of report.categoryStats.slice(0, 6)) {
      const category = cat.category.padEnd(10)
      const count = String(cat.taskCount).padStart(5)
      const rate = `${cat.successRate}%`.padStart(6)
      const duration = formatDuration(cat.avgDurationMs).padStart(10)
      const nodes = String(cat.avgNodeCount).padStart(6)
      lines.push(`  ${category} ${count}  ${rate}  ${duration}   ${nodes}`)
    }
    lines.push('')
  }

  // 节点组合热力图
  if (report.nodeHeatmap.length > 0) {
    lines.push('【常用节点组合】')
    lines.push('  组合                                    出现  成功率')
    lines.push('  ' + '-'.repeat(55))
    for (const combo of report.nodeHeatmap.slice(0, 5)) {
      const name = combo.combination.slice(0, 38).padEnd(38)
      const count = String(combo.count).padStart(4)
      const rate = `${combo.successRate}%`.padStart(6)
      lines.push(`  ${name} ${count}  ${rate}`)
    }
    lines.push('')
  }

  // 成本优化建议
  if (report.costOptimizations.length > 0) {
    lines.push('【成本优化建议】')
    for (const opt of report.costOptimizations.slice(0, 3)) {
      const saving = opt.potentialSavingUsd > 0.001 ? ` (可节省 $${opt.potentialSavingUsd.toFixed(4)})` : ''
      lines.push(`  • ${opt.suggestion}${saving}`)
    }
    lines.push('')
  }

  lines.push('═'.repeat(60))

  return lines.join('\n')
}

/**
 * 格式化趋势报告为 Markdown
 */
export function formatTrendReportForMarkdown(report: TrendReport): string {
  const lines: string[] = []

  lines.push('# 趋势分析报告')
  lines.push('')
  lines.push(`> 分析周期: ${report.periodStart.toLocaleDateString()} - ${report.periodEnd.toLocaleDateString()}`)
  lines.push(`> 生成时间: ${new Date(report.generatedAt).toLocaleString()}`)
  lines.push('')

  // 洞察
  lines.push('## 关键洞察')
  lines.push('')
  for (const insight of report.insights) {
    lines.push(`- ${insight}`)
  }
  lines.push('')

  // 周期趋势
  lines.push('## 执行趋势')
  lines.push('')
  lines.push('| 周期 | 任务数 | 成功率 | 平均耗时 | 成本 |')
  lines.push('|------|--------|--------|----------|------|')
  for (const trend of report.trends) {
    lines.push(`| ${trend.period.label} | ${trend.taskCount} | ${trend.successRate}% | ${formatDuration(trend.avgDurationMs)} | $${trend.totalCostUsd.toFixed(2)} |`)
  }
  lines.push('')

  // 节点性能
  if (report.nodePerformance.length > 0) {
    lines.push('## 节点性能')
    lines.push('')
    lines.push('| 节点名称 | 类型 | 执行数 | 成功率 | 平均耗时 | 总成本 |')
    lines.push('|----------|------|--------|--------|----------|--------|')
    for (const node of report.nodePerformance.slice(0, 10)) {
      lines.push(`| ${node.nodeName} | ${node.nodeType} | ${node.executionCount} | ${node.successRate}% | ${formatDuration(node.avgDurationMs)} | $${node.totalCostUsd.toFixed(4)} |`)
    }
    lines.push('')
  }

  // 成本分布
  lines.push('## 成本分布')
  lines.push('')
  lines.push(`- **总成本**: $${report.costBreakdown.totalCostUsd.toFixed(4)}`)
  lines.push(`- **平均每任务**: $${report.costBreakdown.avgCostPerTask.toFixed(4)}`)
  lines.push(`- **平均每节点**: $${report.costBreakdown.avgCostPerNode.toFixed(6)}`)
  lines.push('')

  if (report.costBreakdown.byNodeType.length > 0) {
    lines.push('### 按节点类型')
    lines.push('')
    lines.push('| 节点类型 | 成本 | 占比 |')
    lines.push('|----------|------|------|')
    for (const item of report.costBreakdown.byNodeType) {
      lines.push(`| ${item.nodeType} | $${item.costUsd.toFixed(4)} | ${item.percentage}% |`)
    }
    lines.push('')
  }

  // 任务类型统计
  if (report.categoryStats.length > 0) {
    lines.push('## 任务类型分布')
    lines.push('')
    lines.push('| 类型 | 任务数 | 成功率 | 平均耗时 | 平均节点数 | 总成本 |')
    lines.push('|------|--------|--------|----------|------------|--------|')
    for (const cat of report.categoryStats) {
      lines.push(`| ${cat.category} | ${cat.taskCount} | ${cat.successRate}% | ${formatDuration(cat.avgDurationMs)} | ${cat.avgNodeCount} | $${cat.totalCostUsd.toFixed(4)} |`)
    }
    lines.push('')
  }

  // 节点组合热力图
  if (report.nodeHeatmap.length > 0) {
    lines.push('## 常用节点组合 (热力图)')
    lines.push('')
    lines.push('| 节点组合 | 出现次数 | 成功率 | 平均耗时 |')
    lines.push('|----------|----------|--------|----------|')
    for (const combo of report.nodeHeatmap.slice(0, 10)) {
      lines.push(`| ${combo.combination} | ${combo.count} | ${combo.successRate}% | ${formatDuration(combo.avgDurationMs)} |`)
    }
    lines.push('')
  }

  // 成本优化建议
  if (report.costOptimizations.length > 0) {
    lines.push('## 成本优化建议')
    lines.push('')
    for (const opt of report.costOptimizations) {
      const typeLabel = {
        high_cost_node: '高成本节点',
        redundant_nodes: '冗余节点',
        batch_opportunity: '批量处理',
        retry_waste: '重试浪费',
      }[opt.type]
      lines.push(`### ${typeLabel}`)
      lines.push('')
      lines.push(`- **建议**: ${opt.suggestion}`)
      if (opt.potentialSavingUsd > 0.001) {
        lines.push(`- **潜在节省**: $${opt.potentialSavingUsd.toFixed(4)}`)
      }
      if (opt.affectedItems.length > 0) {
        lines.push(`- **相关项**: ${opt.affectedItems.join(', ')}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}
