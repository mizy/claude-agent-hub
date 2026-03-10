/**
 * CLI command: cah stats
 *
 * Display statistics overview, chat stats, task stats, and growth milestones.
 */

import chalk from 'chalk'
import { Command } from 'commander'
import { header, list, blank, warn } from '../output.js'
import type { StatsOverview, ChatStats, TaskStats, LifecycleStats, GrowthStats, GrowthJournalSummary, WeeklySuccessRate } from '../../statistics/types.js'
import type { DriveGoal } from '../../selfdrive/goals.js'
import { loadRecentEvolutions, loadValueWeights, type EvolutionSummary, type ValueWeight } from './statsDataLoader.js'

export function registerStatsCommand(program: Command) {
  const stats = program.command('stats').description('统计信息')

  // cah stats (default: full overview)
  stats
    .command('overview', { isDefault: true })
    .description('完整统计概览')
    .option('--json', '输出 JSON 格式')
    .option('-f, --force', '强制重新计算（忽略缓存）')
    .action(async (options) => {
      const overview = await loadStats(options.force)
      if (!overview) return
      if (options.json) {
        console.log(JSON.stringify(overview, null, 2))
        return
      }
      printChatStats(overview.chat)
      printTaskStats(overview.task)
      printLifecycleStats(overview.lifecycle)
      printGrowthStats(overview.growth)
      blank()
      console.log(chalk.dim(`统计生成于 ${new Date(overview.generatedAt).toLocaleString()}`))
    })

  // cah stats chat
  stats
    .command('chat')
    .description('聊天统计详情')
    .option('--json', '输出 JSON 格式')
    .action(async (options) => {
      const overview = await loadStats()
      if (!overview) return
      if (options.json) {
        console.log(JSON.stringify(overview.chat, null, 2))
        return
      }
      printChatStats(overview.chat)
    })

  // cah stats task
  stats
    .command('task')
    .description('任务统计详情')
    .option('--json', '输出 JSON 格式')
    .action(async (options) => {
      const overview = await loadStats()
      if (!overview) return
      if (options.json) {
        console.log(JSON.stringify(overview.task, null, 2))
        return
      }
      printTaskStats(overview.task)
    })

  // cah stats growth
  stats
    .command('growth')
    .description('成长里程碑 + 进化反馈')
    .option('--json', '输出 JSON 格式')
    .action(async (options) => {
      const overview = await loadStats()
      if (!overview) return

      // Collect extra data for growth view
      const weeklyRates = overview.task.weeklySuccessRates.slice(-8)
      const evolutions = loadRecentEvolutions(10)
      const valueWeights = await loadValueWeights()

      if (options.json) {
        console.log(JSON.stringify({
          ...overview.growth,
          weeklySuccessRates: weeklyRates,
          recentEvolutions: evolutions,
          valueWeights,
        }, null, 2))
        return
      }

      printGrowthStats(overview.growth)
      printWeeklySuccessRates(weeklyRates)
      printEvolutionHistory(evolutions)
      printValueWeights(valueWeights)
    })

  // cah stats selfdrive
  stats
    .command('selfdrive')
    .description('自驱目标统计')
    .option('--json', '输出 JSON 格式')
    .action(async (options) => {
      try {
        const { listGoals } = await import('../../selfdrive/goals.js')
        const { getAllTasks } = await import('../../store/TaskStore.js')
        const goals = listGoals()
        if (goals.length === 0) {
          warn('暂无自驱目标')
          return
        }

        // Count success/failure from tasks with goalId metadata
        const tasks = getAllTasks()
        const goalStats = new Map<string, { success: number; failure: number }>()
        for (const task of tasks) {
          const goalId = task.metadata?.goalId
          if (!goalId) continue
          const entry = goalStats.get(goalId) ?? { success: 0, failure: 0 }
          if (task.status === 'completed') entry.success++
          else if (task.status === 'failed') entry.failure++
          goalStats.set(goalId, entry)
        }

        if (options.json) {
          const data = goals.map(g => {
            const s = goalStats.get(g.id) ?? { success: 0, failure: 0 }
            const total = s.success + s.failure
            return {
              id: g.id,
              slug: g.slug,
              type: g.type,
              description: g.description,
              enabled: g.enabled,
              schedule: g.schedule,
              lastRunAt: g.lastRunAt ?? null,
              lastResult: g.lastResult ?? null,
              successCount: s.success,
              failureCount: s.failure,
              totalRuns: total,
              successRate: total > 0 ? +(s.success / total).toFixed(3) : null,
            }
          })
          console.log(JSON.stringify(data, null, 2))
          return
        }

        printSelfdriveStats(goals, goalStats)
      } catch (err) {
        const { getErrorMessage } = await import('../../shared/assertError.js')
        warn(`无法加载自驱数据: ${getErrorMessage(err)}`)
      }
    })
}

async function loadStats(force = false): Promise<StatsOverview | null> {
  try {
    const { getStatsOverview } = await import('../../statistics/index.js')
    return getStatsOverview(force)
  } catch (err) {
    const { getErrorMessage } = await import('../../shared/assertError.js')
    warn(`无法加载统计数据: ${getErrorMessage(err)}`)
    return null
  }
}

// ============ Formatters ============

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function printChatStats(chat: ChatStats) {
  header('💬 聊天统计')
  list([
    { label: '总消息数', value: formatNumber(chat.totalMessages) },
    { label: '收到/发出', value: `${formatNumber(chat.inbound)} ↓ / ${formatNumber(chat.outbound)} ↑` },
    { label: '事件/命令', value: `${chat.events} / ${chat.commands}` },
    { label: '会话数', value: chat.sessionCount },
    { label: '活跃天数', value: chat.activeDays },
    { label: '平均响应', value: chat.avgResponseMs > 0 ? formatDuration(chat.avgResponseMs) : '-' },
    { label: '连续活跃', value: `当前 ${chat.currentStreak}天 / 最长 ${chat.longestStreak}天` },
  ])

  if (chat.channelDistribution.length > 0) {
    blank()
    console.log(chalk.dim('  频道分布:'))
    for (const ch of chat.channelDistribution) {
      const bar = '█'.repeat(Math.max(1, Math.round(ch.percentage / 5)))
      console.log(`    ${chalk.cyan(ch.platform.padEnd(10))} ${chalk.green(bar)} ${ch.percentage.toFixed(0)}%`)
    }
  }

  if (chat.hourDistribution.length > 0) {
    blank()
    console.log(chalk.dim('  活跃时段:'))
    const maxCount = Math.max(...chat.hourDistribution.map(h => h.count))
    const topHours = chat.hourDistribution
      .filter(h => h.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
    for (const h of topHours) {
      const bar = '█'.repeat(Math.max(1, Math.round((h.count / maxCount) * 10)))
      console.log(`    ${String(h.hour).padStart(2)}:00  ${chalk.green(bar)} ${h.count}`)
    }
  }
}

function printTaskStats(task: TaskStats) {
  header('📋 任务统计')
  const successRateStr = task.total > 0
    ? `${(task.successRate * 100).toFixed(1)}%`
    : '-'
  const successColor = task.successRate >= 0.8 ? chalk.green : task.successRate >= 0.5 ? chalk.yellow : chalk.red

  list([
    { label: '总任务数', value: task.total },
    { label: '完成/失败', value: `${chalk.green(task.completed)} / ${chalk.red(task.failed)}` },
    { label: '取消/待定', value: `${task.cancelled} / ${task.pending}` },
    { label: '成功率', value: successColor(successRateStr) },
    { label: '平均耗时', value: task.avgDurationMs > 0 ? formatDuration(task.avgDurationMs) : '-' },
    { label: '平均节点数', value: task.avgNodeCount > 0 ? task.avgNodeCount.toFixed(1) : '-' },
  ])

  if (task.topBackends.length > 0) {
    blank()
    console.log(chalk.dim('  Top Backends:'))
    for (const b of task.topBackends.slice(0, 3)) {
      console.log(`    ${chalk.cyan(b.name.padEnd(15))} ${b.count} 次`)
    }
  }

  if (task.topModels.length > 0) {
    blank()
    console.log(chalk.dim('  Top Models:'))
    for (const m of task.topModels.slice(0, 3)) {
      console.log(`    ${chalk.cyan(m.name.padEnd(25))} ${m.count} 次`)
    }
  }

  if (task.weeklySuccessRates.length > 0) {
    blank()
    console.log(chalk.dim('  周成功率趋势:'))
    for (const w of task.weeklySuccessRates.slice(-4)) {
      const rate = (w.rate * 100).toFixed(0) + '%'
      const bar = '█'.repeat(Math.max(1, Math.round(w.rate * 10)))
      const color = w.rate >= 0.8 ? chalk.green : w.rate >= 0.5 ? chalk.yellow : chalk.red
      console.log(`    ${w.week}  ${color(bar)} ${rate} (${w.succeeded}/${w.total})`)
    }
  }
}

function printLifecycleStats(lifecycle: LifecycleStats) {
  header('🔄 生命周期')
  const statusStr = lifecycle.isRunning
    ? chalk.green('● 运行中')
    : chalk.dim('○ 已停止')

  list([
    { label: '状态', value: statusStr },
    { label: '启动次数', value: lifecycle.startCount },
    { label: '总运行时间', value: formatDuration(lifecycle.totalUptimeMs) },
    { label: '最长连续', value: formatDuration(lifecycle.longestUptimeMs) },
    { label: '当前运行', value: lifecycle.isRunning ? formatDuration(lifecycle.currentUptimeMs) : '-' },
    { label: '上次启动', value: lifecycle.lastStartedAt ? new Date(lifecycle.lastStartedAt).toLocaleString() : '-' },
  ])

  if (lifecycle.versionHistory.length > 0) {
    blank()
    console.log(chalk.dim('  版本历史:'))
    for (const v of lifecycle.versionHistory.slice(-5)) {
      console.log(`    ${chalk.cyan(v.version.padEnd(12))} ${chalk.dim(new Date(v.timestamp).toLocaleDateString())}`)
    }
  }
}

function printGrowthStats(growth: GrowthStats) {
  header('🌱 成长里程碑')
  list([
    { label: '诞生日', value: growth.birthDate ? new Date(growth.birthDate).toLocaleDateString() : '-' },
    { label: '已存活', value: `${growth.ageDays} 天` },
    { label: '活跃天数', value: `${growth.activeDays} 天` },
    { label: '记忆总数', value: growth.totalMemories },
  ])

  if (growth.milestones.length > 0) {
    blank()
    console.log(chalk.dim('  里程碑时间线:'))
    for (const m of growth.milestones) {
      const date = new Date(m.achievedAt).toLocaleDateString()
      console.log(`    ${chalk.yellow('★')} ${chalk.cyan(m.label.padEnd(20))} ${chalk.dim(date)}`)
    }
  }

  // Growth journal section
  if (growth.journal) {
    printGrowthJournal(growth.journal)
  }
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  feature: '新功能',
  fix: '修复',
  refactor: '重构',
  optimization: '优化',
  evolution: '自进化',
}

function printGrowthJournal(journal: GrowthJournalSummary) {
  if (journal.totalEntries === 0) return

  blank()
  header('📈 成长日志')
  list([
    { label: '总记录', value: journal.totalEntries },
    { label: '本周成长', value: journal.weeklyCount },
    { label: '本月成长', value: journal.monthlyCount },
  ])

  // Type breakdown
  const typeEntries = Object.entries(journal.byType).filter(([, v]) => v > 0)
  if (typeEntries.length > 0) {
    blank()
    console.log(chalk.dim('  成长类型分布:'))
    const maxCount = Math.max(...typeEntries.map(([, v]) => v))
    for (const [type, count] of typeEntries.sort((a, b) => b[1] - a[1])) {
      const label = CHANGE_TYPE_LABELS[type] || type
      const bar = '█'.repeat(Math.max(1, Math.round((count / maxCount) * 10)))
      console.log(`    ${chalk.cyan(label.padEnd(8))} ${chalk.green(bar)} ${count}`)
    }
  }

  // Recent milestones from journal
  if (journal.recentMilestones.length > 0) {
    blank()
    console.log(chalk.dim('  进化里程碑:'))
    for (const m of journal.recentMilestones.slice(-5)) {
      const date = new Date(m.date).toLocaleDateString()
      console.log(`    ${chalk.yellow('★')} ${chalk.cyan(m.milestone.slice(0, 40).padEnd(42))} ${chalk.dim(date)}`)
    }
  }
}

function printWeeklySuccessRates(rates: WeeklySuccessRate[]) {
  if (rates.length === 0) return

  blank()
  header('📊 周任务成功率（最近 8 周）')
  for (const w of rates) {
    const pct = (w.rate * 100).toFixed(0) + '%'
    const bar = '█'.repeat(Math.max(1, Math.round(w.rate * 10)))
    const color = w.rate >= 0.8 ? chalk.green : w.rate >= 0.5 ? chalk.yellow : chalk.red
    console.log(`  ${chalk.dim(w.week)}  ${color(bar)} ${pct} (${w.succeeded}/${w.total})`)
  }
}

function printEvolutionHistory(evolutions: EvolutionSummary[]) {
  if (evolutions.length === 0) return

  blank()
  header('🧬 最近自进化记录')
  for (const evo of evolutions) {
    const date = new Date(evo.startedAt).toLocaleDateString()
    const statusIcon = evo.status === 'completed' ? chalk.green('✓') : chalk.red('✗')
    const desc = evo.improvements.length > 0
      ? evo.improvements.map(i => i.description).join('; ').slice(0, 80)
      : '(无改进记录)'
    console.log(`  ${statusIcon} ${chalk.dim(date)} ${chalk.cyan(evo.trigger.padEnd(8))} ${desc}`)

    // Show before/after metrics if available
    if (evo.beforeMetrics && evo.afterMetrics) {
      const before = formatMetricValue(evo.beforeMetrics)
      const after = formatMetricValue(evo.afterMetrics)
      if (before && after) {
        console.log(`    ${chalk.dim('效果:')} ${before} → ${after}`)
      }
    } else if (evo.performanceAnalysis?.summary) {
      console.log(`    ${chalk.dim('分析:')} ${evo.performanceAnalysis.summary.slice(0, 60)}`)
    }
  }
}

function formatMetricValue(metrics: Record<string, unknown>): string {
  // Try to extract structured evolution metrics first
  const evo = metrics.evolution as Record<string, unknown> | undefined
  const source = evo ?? metrics
  if (typeof source.successRate === 'number') {
    return `成功率 ${(source.successRate * 100).toFixed(0)}%`
  }
  if (typeof source.avgDurationMs === 'number') {
    return `平均耗时 ${formatDuration(source.avgDurationMs)}`
  }
  return ''
}

function printValueWeights(weights: ValueWeight[]) {
  if (weights.length === 0) return

  const LABELS: Record<string, string> = {
    code_quality: '代码质量',
    ux_polish: '用户体验',
    new_features: '新功能',
    performance: '性能',
    stability: '稳定性',
    autonomy: '自主性',
  }

  blank()
  header('⚖️ 价值偏好权重')
  for (const v of weights) {
    const label = LABELS[v.dimension] ?? v.dimension
    const barLen = Math.max(1, Math.round(v.weight * 10))
    const bar = '█'.repeat(barLen) + '░'.repeat(10 - barLen)
    const color = v.weight >= 0.7 ? chalk.green : v.weight >= 0.4 ? chalk.yellow : chalk.dim
    console.log(`  ${chalk.cyan(label.padEnd(8))} ${color(bar)} ${v.weight.toFixed(2)}`)
  }
}

function printSelfdriveStats(goals: DriveGoal[], goalStats: Map<string, { success: number; failure: number }>) {
  header('🚀 自驱目标统计')

  for (const goal of goals) {
    const status = goal.enabled ? chalk.green('● 启用') : chalk.dim('○ 禁用')
    const s = goalStats.get(goal.id) ?? { success: 0, failure: 0 }
    const total = s.success + s.failure
    const rateStr = total > 0
      ? `${(s.success / total * 100).toFixed(0)}% (${s.success}/${total})`
      : '-'
    const rateColor = total === 0
      ? chalk.dim
      : s.success / total >= 0.8 ? chalk.green : s.success / total >= 0.5 ? chalk.yellow : chalk.red
    const lastResultStr = goal.lastResult
      ? (goal.lastResult === 'success' ? chalk.green('✓ 成功') : chalk.red('✗ 失败'))
      : chalk.dim('-')

    blank()
    console.log(`  ${chalk.bold(goal.slug ?? goal.type)} ${status} ${chalk.dim(`[${goal.schedule}]`)}`)
    console.log(chalk.dim(`  ${goal.description}`))
    list([
      { label: '上次运行', value: goal.lastRunAt ? new Date(goal.lastRunAt).toLocaleString() : '-' },
      { label: '上次结果', value: lastResultStr },
      { label: '成功率', value: rateColor(rateStr) },
    ])
  }
}
