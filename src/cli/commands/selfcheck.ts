import { Command } from 'commander'
import chalk from 'chalk'
import { runSelfcheck, runFixes, generateRepairTask } from '../../selfcheck/index.js'
import type { CheckResult, SelfcheckReport } from '../../selfcheck/index.js'

const STATUS_ICON: Record<string, string> = {
  pass: chalk.green('✓'),
  fail: chalk.red('✗'),
  warning: chalk.yellow('⚠'),
}

function printCheckResult(check: CheckResult): void {
  const icon = STATUS_ICON[check.status] ?? '?'
  console.log(`${icon} ${check.name}`)
  for (const detail of check.details) {
    console.log(chalk.gray(`  - ${detail}`))
  }
  if (check.diagnosis) {
    console.log(chalk.dim(`  📋 ${check.diagnosis.rootCause}`))
    console.log(chalk.dim(`  💡 ${check.diagnosis.suggestedFix}`))
  }
}

function printReport(report: SelfcheckReport): void {
  for (const check of report.checks) {
    printCheckResult(check)
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

export function registerSelfcheckCommand(program: Command) {
  program
    .command('selfcheck')
    .description('运行系统健康检查')
    .option('--fix', '自动修复可修复的问题')
    .option('--auto-fix', '自动修复并验证（修复后重跑检查）')
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

        // --auto-fix: re-run selfcheck to verify fixes
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
          console.log(chalk.cyan('💡 执行 cah selfcheck --auto-fix 自动修复可修复的问题'))
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
          console.log(chalk.gray('  执行 cah task list 查看任务'))
        } else {
          console.log(chalk.gray('  没有需要创建修复任务的问题'))
        }
      } else if (effectiveReport.hasFailed) {
        const hasUnfixable = effectiveReport.checks.some(c => c.status === 'fail' && !c.fixable)
        if (hasUnfixable) {
          console.log(chalk.cyan('💡 执行 cah selfcheck --repair 为无法自动修复的问题创建修复任务'))
        }
      }

      console.log()
      process.exit(report.hasFailed ? 1 : 0)
    })
}
