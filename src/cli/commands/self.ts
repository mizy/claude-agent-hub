/**
 * @entry self 命令组 — 统一 selfcheck / selfevolve / selfdrive
 *
 * cah self check    → 健康检查（别名到 selfcheck）
 * cah self evolve   → 自我进化
 * cah self drive    → 自驱模式
 * cah self status   → 综合状态
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { runSelfcheck, runFixes, generateRepairTask } from '../../selfcheck/index.js'
import type { SelfcheckReport } from '../../selfcheck/index.js'
import { registerSelfEvolveCommand } from './selfEvolve.js'
import { registerSelfDriveCommand } from './selfDrive.js'

function printReport(report: SelfcheckReport): void {
  const STATUS_ICON: Record<string, string> = {
    pass: chalk.green('✓'),
    fail: chalk.red('✗'),
    warning: chalk.yellow('⚠'),
  }

  for (const check of report.checks) {
    const icon = STATUS_ICON[check.status] ?? '?'
    console.log(`${icon} ${check.name}`)
    for (const detail of check.details) {
      console.log(chalk.gray(`  - ${detail}`))
    }
    if (check.diagnosis) {
      console.log(chalk.dim(`  📋 ${check.diagnosis.rootCause}`))
      console.log(chalk.dim(`  💡 ${check.diagnosis.suggestedFix}`))
    }
    console.log()
  }

  const scoreColor =
    report.totalScore >= 80
      ? chalk.green
      : report.totalScore >= 60
        ? chalk.yellow
        : chalk.red
  console.log(`健康评分: ${scoreColor(`${report.totalScore}/100`)}`)
}

export function registerSelfCommand(program: Command) {
  const self = program
    .command('self')
    .description('系统自管理（健康检查、自进化、自驱）')

  // self check — mirrors selfcheck command
  self
    .command('check')
    .description('运行系统健康检查')
    .option('--fix', '自动修复可修复的问题')
    .option('--auto-fix', '自动修复并验证')
    .option('--repair', '为无法自动修复的问题创建修复任务')
    .action(async (options: { fix?: boolean; autoFix?: boolean; repair?: boolean }) => {
      console.log()
      console.log(chalk.bold('🏥 健康检查'))
      console.log()

      const report = await runSelfcheck()
      printReport(report)

      const shouldFix = options.fix || options.autoFix

      const hasFixable = report.checks.some(c => (c.status === 'fail' || c.status === 'warning') && c.fixable)
      if (shouldFix && (report.hasFailed || hasFixable)) {
        console.log()
        console.log(chalk.bold('🔧 自动修复'))
        console.log()
        const fixes = await runFixes(report)
        if (fixes.length === 0) {
          console.log(chalk.gray('  没有可自动修复的问题'))
        } else {
          for (const fix of fixes) {
            console.log(chalk.green('  ✓'), fix)
          }
        }

        if (options.autoFix && fixes.length > 0) {
          console.log()
          console.log(chalk.bold('🔄 验证修复结果'))
          console.log()
          const verifyReport = await runSelfcheck()
          printReport(verifyReport)

          if (verifyReport.totalScore > report.totalScore) {
            console.log(
              chalk.green(`\n✓ 评分提升: ${report.totalScore} → ${verifyReport.totalScore}`)
            )
          } else if (verifyReport.hasFailed) {
            console.log(chalk.yellow('\n⚠ 仍有未修复的问题'))
          }

          console.log()
          process.exit(verifyReport.hasFailed ? 1 : 0)
          return
        }
      } else if (report.hasFailed || report.hasWarning) {
        const hasFixableHint = report.checks.some(c => (c.status === 'fail' || c.status === 'warning') && c.fixable)
        if (hasFixableHint) {
          console.log()
          console.log(chalk.cyan('💡 执行 cah self check --auto-fix 自动修复'))
        }
      }

      // Generate repair task for unfixable failures
      const effectiveReport = shouldFix ? (await runSelfcheck()) : report
      if (options.repair && effectiveReport.hasFailed) {
        console.log()
        console.log(chalk.bold('🛠️  创建修复任务'))
        console.log()
        const result = await generateRepairTask(effectiveReport)
        if (result) {
          console.log(chalk.green(`  ✓ 已创建修复任务: ${result.taskId}`))
        } else {
          console.log(chalk.gray('  没有需要创建修复任务的问题'))
        }
      } else if (effectiveReport.hasFailed) {
        const hasUnfixable = effectiveReport.checks.some(c => c.status === 'fail' && !c.fixable)
        if (hasUnfixable) {
          console.log(chalk.cyan('💡 执行 cah self check --repair 创建修复任务'))
        }
      }

      console.log()
      process.exit(report.hasFailed ? 1 : 0)
    })

  // self evolve — subcommands
  registerSelfEvolveCommand(self)

  // self drive — subcommands
  registerSelfDriveCommand(self)

  // self status — comprehensive status overview
  self
    .command('status')
    .description('查看综合状态（健康+进化+自驱）')
    .action(async () => {
      console.log()
      console.log(chalk.bold('🤖 Self 综合状态'))
      console.log()

      // 1. Health check
      const report = await runSelfcheck()
      const scoreColor =
        report.totalScore >= 80 ? chalk.green :
        report.totalScore >= 60 ? chalk.yellow : chalk.red
      console.log(`${chalk.bold('健康')}  ${scoreColor(`${report.totalScore}/100`)}`)

      const failCount = report.checks.filter(c => c.status === 'fail').length
      const warnCount = report.checks.filter(c => c.status === 'warning').length
      if (failCount > 0) console.log(chalk.red(`  ${failCount} 项失败`))
      if (warnCount > 0) console.log(chalk.yellow(`  ${warnCount} 项警告`))
      console.log()

      // 2. Evolution status
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

      // 3. Self-drive status
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
