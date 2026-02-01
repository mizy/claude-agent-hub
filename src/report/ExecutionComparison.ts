/**
 * 执行对比分析
 * 对比相似任务的执行差异，识别性能退化
 */

import { readdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { TASKS_DIR } from '../store/paths.js'
import { readJson } from '../store/json.js'
import { formatDuration } from '../store/ExecutionStatsStore.js'
import type { ExecutionSummary } from '../store/ExecutionStatsStore.js'
import type { TaskCategory } from '../agent/executionHistory.js'

// ============ 类型定义 ============

/** 任务执行快照 */
export interface TaskExecutionSnapshot {
  taskId: string
  title: string
  category: TaskCategory
  status: string
  createdAt: Date
  durationMs: number
  costUsd: number
  nodeCount: number
  nodeNames: string[]
  successRate: number
}

/** 执行对比结果 */
export interface ComparisonResult {
  task1: TaskExecutionSnapshot
  task2: TaskExecutionSnapshot
  /** 时间差异百分比 (正数表示 task2 更慢) */
  durationDiffPercent: number
  /** 成本差异百分比 */
  costDiffPercent: number
  /** 节点数差异 */
  nodeCountDiff: number
  /** 是否性能退化 */
  isRegression: boolean
  /** 差异分析 */
  analysis: string[]
}

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
    category: TaskCategory
    avgDurationChange: number
    avgCostChange: number
    sampleCount: number
  }>
  /** 总结 */
  summary: string[]
}

// ============ 辅助函数 ============

/**
 * 任务类型分类
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
 * 收集任务执行快照
 */
function collectTaskSnapshots(daysBack: number = 30): TaskExecutionSnapshot[] {
  if (!existsSync(TASKS_DIR)) {
    return []
  }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)

  const taskFolders = readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('task-'))
    .map(d => d.name)

  const snapshots: TaskExecutionSnapshot[] = []

  for (const folder of taskFolders) {
    const taskPath = join(TASKS_DIR, folder)
    const taskJsonPath = join(taskPath, 'task.json')
    const statsPath = join(taskPath, 'stats.json')
    const workflowPath = join(taskPath, 'workflow.json')
    const instancePath = join(taskPath, 'instance.json')

    if (!existsSync(taskJsonPath)) continue

    const taskJson = readJson<{
      id: string
      title: string
      description?: string
      createdAt: string
      status: string
    }>(taskJsonPath, { defaultValue: null })
    if (!taskJson) continue

    const createdAt = new Date(taskJson.createdAt)
    if (createdAt < cutoffDate) continue

    // 只分析已完成的任务
    if (taskJson.status !== 'completed' && taskJson.status !== 'failed') continue

    // 读取统计数据
    const stats = readJson<{ summary: ExecutionSummary }>(statsPath, { defaultValue: null })

    // 计算执行时长
    let durationMs = 0
    if (stats?.summary?.totalDurationMs) {
      durationMs = stats.summary.totalDurationMs
    } else if (existsSync(instancePath)) {
      const instance = readJson<{ startedAt?: string; completedAt?: string }>(instancePath, { defaultValue: null })
      if (instance?.startedAt && instance?.completedAt) {
        durationMs = new Date(instance.completedAt).getTime() - new Date(instance.startedAt).getTime()
      }
    }

    // 读取节点名称
    let nodeNames: string[] = []
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

    const category = categorizeTask(taskJson.title, taskJson.description)

    snapshots.push({
      taskId: folder,
      title: taskJson.title,
      category,
      status: taskJson.status,
      createdAt,
      durationMs,
      costUsd: stats?.summary?.totalCostUsd || 0,
      nodeCount: stats?.summary?.nodesTotal || nodeNames.length,
      nodeNames,
      successRate: taskJson.status === 'completed' ? 100 : 0,
    })
  }

  return snapshots.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

/**
 * 计算两个任务的相似度 (0-1)
 */
function calculateSimilarity(t1: TaskExecutionSnapshot, t2: TaskExecutionSnapshot): number {
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
function compareTasks(t1: TaskExecutionSnapshot, t2: TaskExecutionSnapshot): ComparisonResult {
  const durationDiffPercent = t1.durationMs > 0
    ? Math.round(((t2.durationMs - t1.durationMs) / t1.durationMs) * 100)
    : 0

  const costDiffPercent = t1.costUsd > 0
    ? Math.round(((t2.costUsd - t1.costUsd) / t1.costUsd) * 100)
    : 0

  const nodeCountDiff = t2.nodeCount - t1.nodeCount

  // 判断是否退化：时间增加 > 20% 或成本增加 > 30%
  const isRegression = durationDiffPercent > 20 || costDiffPercent > 30

  const analysis: string[] = []

  if (durationDiffPercent > 20) {
    analysis.push(`执行时间增加 ${durationDiffPercent}% (${formatDuration(t1.durationMs)} → ${formatDuration(t2.durationMs)})`)
  } else if (durationDiffPercent < -20) {
    analysis.push(`执行时间减少 ${-durationDiffPercent}% (${formatDuration(t1.durationMs)} → ${formatDuration(t2.durationMs)})`)
  }

  if (costDiffPercent > 30) {
    analysis.push(`成本增加 ${costDiffPercent}% ($${t1.costUsd.toFixed(4)} → $${t2.costUsd.toFixed(4)})`)
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
    analysis.push(`新增节点: ${addedNodes.slice(0, 3).join(', ')}${addedNodes.length > 3 ? '...' : ''}`)
  }
  if (removedNodes.length > 0) {
    analysis.push(`移除节点: ${removedNodes.slice(0, 3).join(', ')}${removedNodes.length > 3 ? '...' : ''}`)
  }

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

// ============ 公开 API ============

/**
 * 对比两个指定的任务
 */
export function compareTasksById(taskId1: string, taskId2: string): ComparisonResult | null {
  const snapshots = collectTaskSnapshots(90) // 扩大范围
  const t1 = snapshots.find(s => s.taskId === taskId1 || s.taskId.includes(taskId1))
  const t2 = snapshots.find(s => s.taskId === taskId2 || s.taskId.includes(taskId2))

  if (!t1 || !t2) {
    return null
  }

  return compareTasks(t1, t2)
}

/**
 * 生成性能退化报告
 */
export function generateRegressionReport(daysBack: number = 30): RegressionReport {
  const snapshots = collectTaskSnapshots(daysBack)

  const regressions: ComparisonResult[] = []
  const improvements: ComparisonResult[] = []
  const categoryData = new Map<TaskCategory, { totalDurationChange: number; totalCostChange: number; count: number }>()

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
        const existing = categoryData.get(t1.category) || { totalDurationChange: 0, totalCostChange: 0, count: 0 }
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
  const summary: string[] = []

  if (regressions.length > 0) {
    summary.push(`检测到 ${regressions.length} 处性能退化`)
    const worstRegression = regressions.sort((a, b) => b.durationDiffPercent - a.durationDiffPercent)[0]!
    summary.push(`最严重退化: ${worstRegression.task2.title} (时间 +${worstRegression.durationDiffPercent}%)`)
  }

  if (improvements.length > 0) {
    summary.push(`发现 ${improvements.length} 处性能改进`)
  }

  const slowingCategories = categoryTrends.filter(t => t.avgDurationChange > 10)
  if (slowingCategories.length > 0) {
    summary.push(`变慢的任务类型: ${slowingCategories.map(c => `${c.category}(+${c.avgDurationChange}%)`).join(', ')}`)
  }

  const improvingCategories = categoryTrends.filter(t => t.avgDurationChange < -10)
  if (improvingCategories.length > 0) {
    summary.push(`提速的任务类型: ${improvingCategories.map(c => `${c.category}(${c.avgDurationChange}%)`).join(', ')}`)
  }

  if (summary.length === 0) {
    summary.push('各项指标稳定，未检测到明显性能变化')
  }

  return {
    generatedAt: new Date().toISOString(),
    analyzedTasks: snapshots.length,
    regressions: regressions.slice(0, 10),
    improvements: improvements.slice(0, 10),
    categoryTrends,
    summary,
  }
}

/**
 * 格式化性能退化报告为终端输出
 */
export function formatRegressionReportForTerminal(report: RegressionReport): string {
  const lines: string[] = []

  lines.push('═'.repeat(60))
  lines.push('  性能对比分析报告')
  lines.push('═'.repeat(60))
  lines.push('')

  lines.push(`  分析任务数: ${report.analyzedTasks}`)
  lines.push(`  生成时间: ${new Date(report.generatedAt).toLocaleString()}`)
  lines.push('')

  // 总结
  lines.push('【总结】')
  for (const s of report.summary) {
    lines.push(`  • ${s}`)
  }
  lines.push('')

  // 退化列表
  if (report.regressions.length > 0) {
    lines.push('【性能退化】')
    for (const r of report.regressions.slice(0, 5)) {
      lines.push(`  ${r.task1.title.slice(0, 30)} → ${r.task2.title.slice(0, 30)}`)
      for (const a of r.analysis.slice(0, 2)) {
        lines.push(`    ⚠️ ${a}`)
      }
      lines.push('')
    }
  }

  // 改进列表
  if (report.improvements.length > 0) {
    lines.push('【性能改进】')
    for (const r of report.improvements.slice(0, 3)) {
      lines.push(`  ${r.task1.title.slice(0, 30)} → ${r.task2.title.slice(0, 30)}`)
      for (const a of r.analysis.slice(0, 2)) {
        lines.push(`    ✅ ${a}`)
      }
      lines.push('')
    }
  }

  // 类型趋势
  if (report.categoryTrends.length > 0) {
    lines.push('【类型趋势】')
    lines.push('  类型       时间变化  成本变化  样本数')
    lines.push('  ' + '-'.repeat(40))
    for (const t of report.categoryTrends) {
      const category = t.category.padEnd(10)
      const duration = `${t.avgDurationChange >= 0 ? '+' : ''}${t.avgDurationChange}%`.padStart(8)
      const cost = `${t.avgCostChange >= 0 ? '+' : ''}${t.avgCostChange}%`.padStart(8)
      const samples = String(t.sampleCount).padStart(6)
      lines.push(`  ${category} ${duration}  ${cost}  ${samples}`)
    }
    lines.push('')
  }

  lines.push('═'.repeat(60))

  return lines.join('\n')
}

/**
 * 格式化性能退化报告为 Markdown
 */
export function formatRegressionReportForMarkdown(report: RegressionReport): string {
  const lines: string[] = []

  lines.push('# 性能对比分析报告')
  lines.push('')
  lines.push(`> 分析任务数: ${report.analyzedTasks}`)
  lines.push(`> 生成时间: ${new Date(report.generatedAt).toLocaleString()}`)
  lines.push('')

  // 总结
  lines.push('## 总结')
  lines.push('')
  for (const s of report.summary) {
    lines.push(`- ${s}`)
  }
  lines.push('')

  // 退化列表
  if (report.regressions.length > 0) {
    lines.push('## 性能退化')
    lines.push('')
    for (const r of report.regressions) {
      lines.push(`### ${r.task2.title}`)
      lines.push('')
      lines.push(`**对比基准**: ${r.task1.title}`)
      lines.push('')
      lines.push('| 指标 | 变化 |')
      lines.push('|------|------|')
      lines.push(`| 执行时间 | ${r.durationDiffPercent >= 0 ? '+' : ''}${r.durationDiffPercent}% |`)
      lines.push(`| 成本 | ${r.costDiffPercent >= 0 ? '+' : ''}${r.costDiffPercent}% |`)
      lines.push(`| 节点数 | ${r.nodeCountDiff >= 0 ? '+' : ''}${r.nodeCountDiff} |`)
      lines.push('')
      if (r.analysis.length > 0) {
        lines.push('**分析**:')
        for (const a of r.analysis) {
          lines.push(`- ${a}`)
        }
        lines.push('')
      }
    }
  }

  // 改进列表
  if (report.improvements.length > 0) {
    lines.push('## 性能改进')
    lines.push('')
    for (const r of report.improvements) {
      lines.push(`- **${r.task2.title}**: 时间 ${r.durationDiffPercent}%, 成本 ${r.costDiffPercent}%`)
    }
    lines.push('')
  }

  // 类型趋势
  if (report.categoryTrends.length > 0) {
    lines.push('## 类型趋势')
    lines.push('')
    lines.push('| 类型 | 时间变化 | 成本变化 | 样本数 |')
    lines.push('|------|----------|----------|--------|')
    for (const t of report.categoryTrends) {
      lines.push(`| ${t.category} | ${t.avgDurationChange >= 0 ? '+' : ''}${t.avgDurationChange}% | ${t.avgCostChange >= 0 ? '+' : ''}${t.avgCostChange}% | ${t.sampleCount} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
