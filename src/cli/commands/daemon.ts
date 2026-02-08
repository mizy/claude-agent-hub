import { Command } from 'commander'
import { startDaemon } from '../../scheduler/startDaemon.js'
import { stopDaemon } from '../../scheduler/stopDaemon.js'
import { restartDaemon } from '../../scheduler/restartDaemon.js'
import { getDaemonStatus } from '../../scheduler/getDaemonStatus.js'

export function registerDaemonCommands(program: Command) {
  // cah start — start daemon (foreground by default)
  program
    .command('start')
    .description('启动守护进程（自动检测配置启动飞书/Telegram）')
    .option('-D, --detach', '后台运行（fork 子进程）')
    .action(async options => {
      await startDaemon(options)
    })

  // cah stop — stop daemon
  program
    .command('stop')
    .description('停止守护进程')
    .option('-a, --agent <name>', '只停止指定 Agent')
    .action(async options => {
      await stopDaemon(options)
    })

  // cah restart — graceful restart
  program
    .command('restart')
    .description('重启守护进程（优雅停止 + 启动）')
    .option('-D, --detach', '后台运行（默认启用）', true)
    .action(async options => {
      await restartDaemon(options)
    })

  // cah status — daemon & queue status
  program
    .command('status')
    .description('查看守护进程 / 任务队列状态')
    .action(async () => {
      await getDaemonStatus()
    })

  // cah serve — hidden backward-compatible alias for `start`
  program
    .command('serve', { hidden: true })
    .description('启动守护进程（请使用 cah start）')
    .option('-D, --detach', '后台运行（fork 子进程）')
    .action(async options => {
      await startDaemon(options)
    })

  // cah daemon — hidden backward-compatible alias group
  const daemon = program
    .command('daemon', { hidden: true })
    .description('守护进程管理（请使用 start/stop/restart/status）')

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

  daemon
    .command('logs')
    .description('查看守护进程日志')
    .option('-f, --follow', '持续监听日志（类似 tail -f）')
    .option('-n, --lines <count>', '显示最后 N 行', '50')
    .option('-e, --error', '查看错误日志')
    .action(async (options: { follow?: boolean; lines?: string; error?: boolean }) => {
      const { showDaemonLogs } = await import('../../scheduler/showDaemonLogs.js')
      await showDaemonLogs(options)
    })
}
