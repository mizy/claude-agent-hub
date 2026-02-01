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
    .option('--lark', '同时启动飞书事件监听服务器 (HTTP 模式，需要公网 IP)')
    .option('--lark-ws', '同时启动飞书 WebSocket 客户端 (长连接模式，无需公网 IP)')
    .option('--lark-port <port>', '飞书服务器端口 (仅 HTTP 模式)', parseInt)
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
