/**
 * self drive 子命令 — 自驱模式管理
 *
 * cah self drive start   → 启动自驱模式
 * cah self drive stop    → 停止自驱
 * cah self drive status  → 查看自驱状态
 * cah self drive goals   → 查看目标列表
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { getErrorMessage } from '../../shared/assertError.js'

export function registerSelfDriveCommand(parent: Command) {
  const drive = parent
    .command('drive')
    .description('自驱模式管理')

  drive
    .command('start')
    .description('启动自驱模式')
    .action(async () => {
      console.log()
      try {
        const { startSelfDrive, getSelfDriveStatus } = await import('../../selfdrive/index.js')
        startSelfDrive()
        const status = getSelfDriveStatus()

        console.log(chalk.green('✓ 自驱模式已启动'))
        console.log(`  调度器: ${status.scheduler.activeGoals} 个活跃目标`)
        console.log(chalk.gray('  目标将按计划自动执行（健康检查/自进化）'))
      } catch (err) {
        console.log(chalk.red(`启动失败: ${getErrorMessage(err)}`))
        process.exit(1)
      }
      console.log()
    })

  drive
    .command('stop')
    .description('停止自驱模式')
    .action(async () => {
      console.log()
      try {
        const { stopSelfDrive } = await import('../../selfdrive/index.js')
        stopSelfDrive()
        console.log(chalk.yellow('⏹ 自驱模式已停止'))
        console.log(chalk.gray('  目标保留，可随时重新启动'))
      } catch (err) {
        console.log(chalk.red(`停止失败: ${getErrorMessage(err)}`))
        process.exit(1)
      }
      console.log()
    })

  drive
    .command('status')
    .description('查看自驱状态')
    .action(async () => {
      console.log()
      console.log(chalk.bold('🚗 自驱状态'))
      console.log()

      try {
        const { getSelfDriveStatus, listGoals } = await import('../../selfdrive/index.js')
        const status = getSelfDriveStatus()
        const goals = listGoals()

        const icon = status.enabled ? chalk.green('✅ 启用') : chalk.gray('⏹ 停用')
        console.log(`状态: ${icon}`)

        if (status.startedAt) {
          console.log(chalk.gray(`  启动时间: ${new Date(status.startedAt).toLocaleString()}`))
        }

        console.log(`调度器: ${status.scheduler.running ? '运行中' : '停止'}`)
        console.log(`活跃目标: ${status.scheduler.activeGoals}`)
        console.log()

        if (goals.length > 0) {
          console.log(chalk.bold('目标列表:'))
          for (const goal of goals) {
            const enabledIcon = goal.enabled ? chalk.green('●') : chalk.gray('○')
            const resultIcon = goal.lastResult === 'success' ? '✅' :
              goal.lastResult === 'failure' ? '❌' : '—'
            const lastRun = goal.lastRunAt
              ? new Date(goal.lastRunAt).toLocaleString()
              : '从未执行'

            console.log(
              `  ${enabledIcon} ${goal.type} (${goal.schedule}) — ${resultIcon} ${chalk.gray(lastRun)}`
            )
            if (goal.lastError) {
              console.log(chalk.red(`    错误: ${goal.lastError}`))
            }
          }
        }
      } catch (err) {
        console.log(chalk.red(`查询失败: ${getErrorMessage(err)}`))
      }

      console.log()
    })

  drive
    .command('goals')
    .description('查看/管理自驱目标')
    .action(async () => {
      console.log()
      console.log(chalk.bold('🎯 自驱目标'))
      console.log()

      try {
        const { listGoals } = await import('../../selfdrive/index.js')
        const goals = listGoals()

        if (goals.length === 0) {
          console.log(chalk.gray('  暂无目标'))
          console.log(chalk.gray('  执行 cah self drive start 初始化内置目标'))
        } else {
          for (const goal of goals) {
            const enabledIcon = goal.enabled ? chalk.green('●') : chalk.gray('○')
            console.log(`${enabledIcon} ${chalk.bold(goal.type)} — ${goal.description}`)
            console.log(chalk.gray(`  ID: ${goal.id}`))
            console.log(chalk.gray(`  调度: ${goal.schedule} | 优先级: ${goal.priority}`))

            if (goal.lastRunAt) {
              const resultIcon = goal.lastResult === 'success' ? '✅' : '❌'
              console.log(chalk.gray(`  上次: ${resultIcon} ${new Date(goal.lastRunAt).toLocaleString()}`))
            }
            console.log()
          }
        }
      } catch (err) {
        console.log(chalk.red(`查询失败: ${getErrorMessage(err)}`))
      }

      console.log()
    })
}
