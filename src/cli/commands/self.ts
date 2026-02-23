/**
 * @entry self 命令组 — 统一 health check / selfevolve / selfdrive
 *
 * cah self check    → 信号检测 + 自动修复
 * cah self evolve   → 自我进化
 * cah self drive    → 自驱模式
 * cah self status   → 综合状态
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { registerSelfEvolveCommand } from './selfEvolve.js'
import { registerSelfDriveCommand } from './selfDrive.js'

export function registerSelfCommand(program: Command) {
  const self = program
    .command('self')
    .description('系统自管理（健康检查、自进化、自驱）')

  // self check — signal detection + auto repair
  self
    .command('check')
    .description('运行信号检测与自动修复')
    .option('--fix', '自动修复检测到的问题')
    .option('--auto-fix', '自动修复并验证')
    .action(async (options: { fix?: boolean; autoFix?: boolean }) => {
      const { runHealthCheck } = await import('../../selfevolve/index.js')

      console.log()
      console.log(chalk.bold('🔍 信号检测'))
      console.log()

      const shouldFix = options.fix || options.autoFix
      const result = await runHealthCheck({ autoFix: shouldFix })

      if (result.signals.length === 0) {
        console.log(chalk.green('✓ 未检测到异常信号'))
        console.log()
        process.exit(0)
        return
      }

      const SEVERITY_ICON: Record<string, string> = {
        critical: chalk.red('✗'),
        warning: chalk.yellow('⚠'),
        info: chalk.blue('ℹ'),
      }

      for (const signal of result.signals) {
        const icon = SEVERITY_ICON[signal.severity] ?? '?'
        console.log(`${icon} ${signal.type} (${signal.severity})`)
        console.log(chalk.gray(`  ${signal.pattern}`))
      }
      console.log()

      if (result.repairs.length > 0) {
        console.log(chalk.bold('🔧 自动修复'))
        console.log()
        for (const { signal, result: desc } of result.repairs) {
          console.log(chalk.green('  ✓'), `[${signal.type}] ${desc}`)
        }
        console.log()

        if (options.autoFix) {
          console.log(chalk.bold('🔄 验证修复结果'))
          console.log()
          const verify = await runHealthCheck()
          if (verify.signals.length === 0) {
            console.log(chalk.green('✓ 所有问题已修复'))
          } else {
            console.log(chalk.yellow(`⚠ 仍有 ${verify.signals.length} 个信号`))
          }
          console.log()
          process.exit(verify.signals.length > 0 ? 1 : 0)
          return
        }
      } else if (shouldFix) {
        console.log(chalk.gray('  没有可自动修复的问题'))
        console.log()
      } else {
        const hasRepairable = result.signals.some(
          s => s.type === 'stale_daemon' || s.type === 'corrupt_task_data'
        )
        if (hasRepairable) {
          console.log(chalk.cyan('💡 执行 cah self check --auto-fix 自动修复'))
          console.log()
        }
      }

      process.exit(result.signals.some(s => s.severity === 'critical') ? 1 : 0)
    })

  // self evolve — subcommands
  registerSelfEvolveCommand(self)

  // self drive — subcommands
  registerSelfDriveCommand(self)

  // self status — comprehensive status overview
  self
    .command('status')
    .description('查看综合状态（任务+信号+进化+自驱）')
    .action(async () => {
      const { detectSignals } = await import('../../selfevolve/index.js')
      const { getAllTasks } = await import('../../store/TaskStore.js')

      console.log()
      console.log(chalk.bold('🤖 Self 综合状态'))
      console.log()

      // 1. Task statistics
      const tasks = getAllTasks()
      const statusCounts: Record<string, number> = {}
      for (const t of tasks) {
        statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1
      }
      console.log(`${chalk.bold('任务')}  共 ${tasks.length} 个`)
      const statusParts: string[] = []
      const STATUS_COLOR: Record<string, (s: string) => string> = {
        completed: chalk.green,
        failed: chalk.red,
        running: chalk.cyan,
        developing: chalk.cyan,
        planning: chalk.cyan,
        pending: chalk.yellow,
        paused: chalk.gray,
        cancelled: chalk.gray,
      }
      for (const [status, count] of Object.entries(statusCounts)) {
        const colorFn = STATUS_COLOR[status] ?? chalk.white
        statusParts.push(colorFn(`${count} ${status}`))
      }
      if (statusParts.length > 0) {
        console.log(`  ${statusParts.join(chalk.gray(' · '))}`)
      }
      // Recent failure rate (last 20 tasks)
      const recent = tasks.slice(0, 20)
      const recentFailed = recent.filter(t => t.status === 'failed').length
      if (recent.length >= 5) {
        const rate = Math.round((recentFailed / recent.length) * 100)
        const rateColor = rate > 50 ? chalk.red : rate > 25 ? chalk.yellow : chalk.green
        console.log(`  近期失败率: ${rateColor(`${rate}%`)} (${recentFailed}/${recent.length})`)
      }
      console.log()

      // 2. Signal detection
      const signals = detectSignals()
      if (signals.length === 0) {
        console.log(`${chalk.bold('健康')}  ${chalk.green('无异常信号')}`)
      } else {
        const critical = signals.filter(s => s.severity === 'critical').length
        const warning = signals.filter(s => s.severity === 'warning').length
        const color = critical > 0 ? chalk.red : chalk.yellow
        console.log(`${chalk.bold('健康')}  ${color(`${signals.length} 个信号`)}`)
        if (critical > 0) console.log(chalk.red(`  ${critical} critical`))
        if (warning > 0) console.log(chalk.yellow(`  ${warning} warning`))
        // Fix hint
        const hasRepairable = signals.some(
          s => s.type === 'stale_daemon' || s.type === 'corrupt_task_data'
        )
        if (hasRepairable) {
          console.log(chalk.cyan(`  💡 cah self check --auto-fix`))
        }
      }
      console.log()

      // 3. Evolution status
      try {
        const { getLatestEvolution, listEvolutions } = await import('../../selfevolve/index.js')
        const evolutions = listEvolutions()
        const latest = getLatestEvolution()

        console.log(`${chalk.bold('进化')}  共 ${evolutions.length} 次`)
        if (latest) {
          const statusIcon = latest.status === 'completed' ? '✅' : latest.status === 'failed' ? '❌' : '⏳'
          console.log(`  最近: ${statusIcon} ${latest.id} — ${latest.patterns.length} 模式, ${latest.improvements.length} 改进`)
        }
        console.log()
      } catch {
        console.log(`${chalk.bold('进化')}  ${chalk.gray('未初始化')}`)
        console.log()
      }

      // 4. Self-drive status
      try {
        const { getSelfDriveStatus, listGoals } = await import('../../selfdrive/index.js')
        const driveStatus = getSelfDriveStatus()
        const goals = listGoals()
        const enabledGoals = goals.filter(g => g.enabled)

        const driveIcon = driveStatus.enabled ? chalk.green('启用') : chalk.gray('停用')
        console.log(`${chalk.bold('自驱')}  ${driveIcon}`)
        console.log(`  目标: ${enabledGoals.length}/${goals.length} 启用`)
        if (driveStatus.scheduler.running) {
          console.log(`  调度: ${driveStatus.scheduler.activeGoals} 个活跃`)
        }
        console.log()
      } catch {
        console.log(`${chalk.bold('自驱')}  ${chalk.gray('未初始化')}`)
        console.log()
      }
    })
}
