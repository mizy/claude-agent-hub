import { Command } from 'commander'
import { startDaemon } from '../../scheduler/startDaemon.js'
import { stopDaemon } from '../../scheduler/stopDaemon.js'
import { getDaemonStatus } from '../../scheduler/getDaemonStatus.js'

export function registerDaemonCommands(program: Command) {
  // cah serve — 默认前台阻塞运行，自动启动配置的通知平台
  program
    .command('serve')
    .description('启动守护进程（自动检测配置启动飞书/Telegram）')
    .option('-D, --detach', '后台运行（fork 子进程）')
    .action(async (options) => {
      await startDaemon(options)
    })

  // cah serve stop / cah serve status — 守护进程管理
  program
    .command('stop')
    .description('停止守护进程')
    .option('-a, --agent <name>', '只停止指定 Agent')
    .action(async (options) => {
      await stopDaemon(options)
    })

  program
    .command('status')
    .description('查看守护进程 / 任务队列状态')
    .action(async () => {
      await getDaemonStatus()
    })

  // cah daemon — 隐藏的向后兼容别名
  const daemon = program
    .command('daemon', { hidden: true })
    .description('守护进程管理（请使用 serve/stop/status）')

  daemon
    .command('start')
    .description('启动守护进程')
    .option('-D, --detach', '后台运行')
    .action(async (options: { detach?: boolean }) => {
      await startDaemon(options)
    })

  daemon
    .command('stop')
    .description('停止守护进程')
    .option('-a, --agent <name>', '只停止指定 Agent')
    .action(async (options: { agent?: string }) => {
      await stopDaemon(options)
    })

  daemon
    .command('status')
    .description('查看守护进程状态')
    .action(async () => {
      await getDaemonStatus()
    })
}
