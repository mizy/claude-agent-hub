/**
 * 报告格式化器
 * 将趋势报告格式化为终端或 Markdown 输出
 */

import { formatDuration } from '../../store/ExecutionStatsStore.js'
import type { TrendReport } from './types.js'

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
