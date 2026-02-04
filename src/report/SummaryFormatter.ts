/**
 * 实时摘要格式化器
 * 将数据格式化为终端输出或 JSON
 */

import chalk from 'chalk'
import { formatDuration } from '../store/ExecutionStatsStore.js'
import type { LiveSummaryReport } from './LiveSummary.js'

/**
 * 格式化实时摘要为终端输出
 */
export function formatLiveSummaryForTerminal(report: LiveSummaryReport): string {
  const lines: string[] = []

  lines.push('')
  lines.push(chalk.cyan.bold('  📊 CAH 实时状态'))
  lines.push(chalk.dim('  ' + '─'.repeat(50)))
  lines.push('')

  // 运行中的任务
  if (report.runningTasks.length > 0) {
    lines.push(chalk.yellow.bold('  🔄 运行中的任务'))
    lines.push('')
    for (const task of report.runningTasks) {
      const progressBar = createProgressBar(task.progress.percentage, 20)
      const elapsed = formatDuration(task.elapsedMs)
      const title = task.title.length > 30 ? task.title.slice(0, 27) + '...' : task.title

      // 预估剩余时间
      let etaStr = ''
      if (task.estimatedRemainingMs !== undefined && task.estimatedRemainingMs > 0) {
        const confidencePrefix = task.estimateConfidence !== undefined
          ? (task.estimateConfidence >= 0.7 ? '' : task.estimateConfidence >= 0.4 ? '~' : '≈')
          : '≈'
        etaStr = chalk.cyan(` ETA: ${confidencePrefix}${formatDuration(task.estimatedRemainingMs)}`)
      }

      lines.push(`    ${chalk.white(title)}`)
      lines.push(`    ${progressBar} ${task.progress.completed}/${task.progress.total} (${elapsed})${etaStr}`)
      if (task.currentNode) {
        lines.push(chalk.dim(`    当前节点: ${task.currentNode}`))
      }
      lines.push('')
    }
  } else {
    lines.push(chalk.dim('  当前没有运行中的任务'))
    lines.push('')
  }

  // 待执行任务队列
  if (report.queuedTasks.length > 0) {
    lines.push(chalk.blue.bold('  📋 待执行队列'))
    lines.push('')
    for (const task of report.queuedTasks.slice(0, 5)) {
      const title = task.title.length > 40 ? task.title.slice(0, 37) + '...' : task.title
      const waiting = formatDuration(Date.now() - task.createdAt.getTime())
      lines.push(`    • ${title}  ${chalk.dim(`等待 ${waiting}`)}`)
    }
    if (report.queuedTasks.length > 5) {
      lines.push(chalk.dim(`    ... 还有 ${report.queuedTasks.length - 5} 个任务`))
    }
    lines.push('')
  }

  // 预估全部完成时间
  if (report.estimatedAllCompletionTime && (report.runningTasks.length > 0 || report.queuedTasks.length > 0)) {
    lines.push(chalk.cyan(`  ⏰ 预计全部完成: ${report.estimatedAllCompletionTime}`))
    lines.push('')
  }

  // 今日统计
  lines.push(chalk.cyan.bold('  📈 今日统计'))
  lines.push('')

  const s = report.todaySummary
  const stats = [
    `创建: ${s.tasksCreated}`,
    chalk.green(`完成: ${s.tasksCompleted}`),
    s.tasksFailed > 0 ? chalk.red(`失败: ${s.tasksFailed}`) : `失败: ${s.tasksFailed}`,
    s.tasksRunning > 0 ? chalk.yellow(`运行: ${s.tasksRunning}`) : `运行: ${s.tasksRunning}`,
  ]

  lines.push(`    ${stats.join('  |  ')}`)
  lines.push('')

  if (s.totalDurationMs > 0 || s.totalCostUsd > 0) {
    lines.push(chalk.dim(`    总耗时: ${formatDuration(s.totalDurationMs)}  |  总成本: $${s.totalCostUsd.toFixed(4)}`))
    lines.push('')
  }

  // 最近完成的任务
  if (report.recentCompleted.length > 0) {
    lines.push(chalk.cyan.bold('  📋 最近完成'))
    lines.push('')
    for (const task of report.recentCompleted) {
      const icon = task.status === 'completed' ? chalk.green('✓') : chalk.red('✗')
      const title = task.title.length > 35 ? task.title.slice(0, 32) + '...' : task.title
      const time = new Date(task.completedAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      lines.push(`    ${icon} ${title}  ${chalk.dim(time)}`)
    }
    lines.push('')
  }

  lines.push(chalk.dim('  ' + '─'.repeat(50)))
  lines.push('')

  return lines.join('\n')
}

/**
 * 创建进度条
 */
function createProgressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width)
  const empty = width - filled
  const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty))
  return `[${bar}] ${percentage}%`
}

/**
 * 格式化实时摘要为 JSON
 */
export function formatLiveSummaryForJson(report: LiveSummaryReport): string {
  return JSON.stringify(report, null, 2)
}
