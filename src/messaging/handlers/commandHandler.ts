/**
 * 统一指令处理器 — 路由层
 *
 * 根据 command 名分发到具体处理模块，不包含业务逻辑。
 * 平台适配层调用 handleCommand()，再通过各自的 MessengerAdapter 发送结果。
 */

import { createLogger } from '../../shared/logger.js'
import { truncateText } from '../../shared/truncateText.js'
import * as taskCmd from './taskCommands.js'
import * as queryCmd from './queryCommands.js'
import * as sysCmd from './systemCommands.js'
import type { CommandResult } from './types.js'

// Re-export all handlers for backward compatibility
export { handleRun, handleStop, handleResume, handleMsg, handlePause, handleSnapshot } from './taskCommands.js'
export { handleList, handleLogs, handleGet } from './queryCommands.js'
export { handleHelp, handleStatus, handleMemory, handleCost, handleReload } from './systemCommands.js'

const logger = createLogger('command-handler')

/**
 * 统一入口：根据 command + args 分发到具体处理函数
 */
export async function handleCommand(command: string, args: string): Promise<CommandResult> {
  const argsPreview = truncateText(args, 40)
  logger.info(`⚡ ${command}${argsPreview ? ' ' + argsPreview : ''}`)

  switch (command) {
    case '/run':
      return taskCmd.handleRun(args)
    case '/list':
      return queryCmd.handleList(args || undefined)
    case '/logs':
      return queryCmd.handleLogs(args)
    case '/stop':
      return taskCmd.handleStop(args)
    case '/resume':
      return taskCmd.handleResume(args)
    case '/get':
      return queryCmd.handleGet(args)
    case '/help':
      return sysCmd.handleHelp()
    case '/status':
      return sysCmd.handleStatus()
    case '/reload':
      return sysCmd.handleReload()
    case '/memory':
      return sysCmd.handleMemory(args)
    case '/cost':
      return sysCmd.handleCost()
    case '/msg':
      return taskCmd.handleMsg(args)
    case '/pause':
      return taskCmd.handlePause(args)
    case '/snapshot':
      return taskCmd.handleSnapshot(args)
    default:
      return { text: `未知指令: ${command}\n输入 /help 查看可用指令` }
  }
}
