/**
 * @entry Server 模块
 *
 * 提供 HTTP server 来可视化 Workflow 执行状态
 *
 * 主要 API:
 * - startServer(options): 启动 HTTP server
 */

export { startServer, type ServerOptions } from './createServer.js'
