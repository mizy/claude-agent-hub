/**
 * Server 命令
 *
 * 启动 HTTP server 来可视化 Workflow 执行状态
 */

import { Command } from 'commander'
import { startServer } from '../../server/index.js'

export function registerServerCommand(program: Command) {
  program
    .command('server')
    .description('启动 Workflow 可视化服务器')
    .option('-p, --port <port>', '服务器端口', '7788')
    .option('-H, --host <host>', '监听地址', 'localhost')
    .option('--open', '启动后自动打开浏览器')
    .action((options) => {
      startServer({
        port: parseInt(options.port, 10),
        host: options.host,
        open: options.open,
      })
    })
}
