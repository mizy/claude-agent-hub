/**
 * 报告格式化器
 * 将退化报告格式化为不同输出格式
 */

import type { RegressionReport } from './DegradationDetector.js'

/**
 * 格式化性能退化报告为终端输出
 */
export function formatRegressionReportForTerminal(
  report: RegressionReport
): string {
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
      lines.push(
        `  ${r.task1.title.slice(0, 30)} → ${r.task2.title.slice(0, 30)}`
      )
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
      lines.push(
        `  ${r.task1.title.slice(0, 30)} → ${r.task2.title.slice(0, 30)}`
      )
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
      const duration = `${t.avgDurationChange >= 0 ? '+' : ''}${t.avgDurationChange}%`.padStart(
        8
      )
      const cost = `${t.avgCostChange >= 0 ? '+' : ''}${t.avgCostChange}%`.padStart(
        8
      )
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
export function formatRegressionReportForMarkdown(
  report: RegressionReport
): string {
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
      lines.push(
        `| 执行时间 | ${r.durationDiffPercent >= 0 ? '+' : ''}${r.durationDiffPercent}% |`
      )
      lines.push(
        `| 成本 | ${r.costDiffPercent >= 0 ? '+' : ''}${r.costDiffPercent}% |`
      )
      lines.push(
        `| 节点数 | ${r.nodeCountDiff >= 0 ? '+' : ''}${r.nodeCountDiff} |`
      )
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
      lines.push(
        `- **${r.task2.title}**: 时间 ${r.durationDiffPercent}%, 成本 ${r.costDiffPercent}%`
      )
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
      lines.push(
        `| ${t.category} | ${t.avgDurationChange >= 0 ? '+' : ''}${t.avgDurationChange}% | ${t.avgCostChange >= 0 ? '+' : ''}${t.avgCostChange}% | ${t.sampleCount} |`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}
