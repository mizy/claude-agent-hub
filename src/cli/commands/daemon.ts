import { Command } from 'commander'
import { startDaemon } from '../../scheduler/startDaemon.js'
import { stopDaemon } from '../../scheduler/stopDaemon.js'
import { getDaemonStatus } from '../../scheduler/getDaemonStatus.js'

export function registerDaemonCommands(program: Command) {
  program
    .command('start')
    .description('启动 Agent 守护进程')
    .option('-a, --agent <name>', '只启动指定 Agent')
    .option('--foreground', '前台运行（不作为守护进程）')
    .action(async (options) => {
      await startDaemon(options)
    })

  program
    .command('stop')
    .description('停止守护进程')
    .option('-a, --agent <name>', '只停止指定 Agent')
    .action(async (options) => {
      await stopDaemon(options)
    })

  program
    .command('status')
    .description('查看守护进程状态')
    .action(async () => {
      await getDaemonStatus()
    })
}
