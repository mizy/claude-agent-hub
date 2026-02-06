/**
 * @entry Notify 通知模块
 *
 * 平台无关的消息处理 + 飞书/Telegram 适配层
 *
 * 主要 API:
 * - handleCommand(): 统一命令处理（/run /list /logs ...）
 * - handleChat(): AI 自由对话
 * - handleApproval(): 审批处理
 * - startTelegramClient(): 启动 Telegram Bot
 * - startLarkWsClient(): 启动飞书 WebSocket
 * - sendLarkMessage(): 发送飞书消息
 * - sendTelegramTextMessage(): 发送 Telegram 消息
 */

// ── 平台无关的 handlers ──

export { handleCommand, handleRun, handleList, handleLogs, handleStop, handleResume, handleGet, handleHelp, handleStatus } from './handlers/commandHandler.js'
export { handleApproval, parseApprovalCommand } from './handlers/approvalHandler.js'
export { handleChat, clearChatSession, getChatSessionInfo } from './handlers/chatHandler.js'
export type { MessengerAdapter, SendOptions, ParsedApproval, ApprovalResult, ChatSession, CommandResult, IncomingMessage } from './handlers/types.js'

// ── 飞书 ──

export {
  sendReviewNotification,
  sendLarkMessage,
  sendLarkMessageViaApi,
  sendApprovalResultNotification,
} from './sendLarkNotify.js'

export {
  startLarkServer,
  stopLarkServer,
  isLarkServerRunning,
} from './larkServer.js'

export {
  startLarkWsClient,
  stopLarkWsClient,
  isLarkWsClientRunning,
  getLarkClient,
} from './larkWsClient.js'

// ── Telegram ──

export {
  sendTelegramReviewNotification,
  sendTelegramTextMessage,
  sendTelegramApprovalResult,
} from './sendTelegramNotify.js'

export {
  startTelegramClient,
  stopTelegramClient,
  isTelegramClientRunning,
  sendTelegramMessage,
  getDefaultChatId,
} from './telegramClient.js'
