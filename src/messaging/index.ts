/**
 * @entry Messaging IM 交互层
 *
 * 平台无关的消息处理 + 飞书/Telegram 适配层 + 任务通知桥接
 *
 * 主要 API:
 * - routeMessage(): 统一消息路由（命令分发 + 对话 + 审批）
 * - handleCommand(): 统一命令处理（/run /list /logs ...）
 * - handleChat(): AI 自由对话
 * - handleApproval(): 审批处理
 * - sendTaskCompletionNotify(): 任务完成/失败通知
 * - startTelegramClient(): 启动 Telegram Bot
 * - startLarkWsClient(): 启动飞书 WebSocket
 * - sendLarkMessage(): 发送飞书消息
 * - sendTelegramTextMessage(): 发送 Telegram 消息
 */

// ── 平台无关的 handlers ──

export {
  handleCommand,
  handleRun,
  handleList,
  handleLogs,
  handleStop,
  handleResume,
  handleGet,
  handleHelp,
  handleStatus,
  handleMsg,
  handlePause,
  handleSnapshot,
} from './handlers/commandHandler.js'
export { handleApproval, parseApprovalCommand } from './handlers/approvalHandler.js'
export { handleChat, clearChatSession, getChatSessionInfo, destroyChatHandler } from './handlers/chatHandler.js'
export { routeMessage, parseCommandText } from './handlers/messageRouter.js'
export { loadSessions } from './handlers/sessionManager.js'
export type {
  MessengerAdapter,
  SendOptions,
  ParsedApproval,
  ApprovalResult,
  ChatSession,
  CommandResult,
  IncomingMessage,
  ClientContext,
} from './handlers/types.js'
export type { RouteMessageOptions } from './handlers/messageRouter.js'

// ── 飞书 ──

export {
  sendReviewNotification,
  sendLarkMessage,
  sendLarkMessageViaApi,
  sendApprovalResultNotification,
  sendLarkCardViaApi,
  updateLarkCard,
  uploadLarkImage,
  sendLarkImage,
} from './sendLarkNotify.js'

export {
  buildCard,
  buildTaskCompletedCard,
  buildTaskFailedCard,
  buildApprovalCard,
  buildAutoWaitCard,
  buildWelcomeCard,
  buildTaskListCard,
  buildTaskDetailCard,
  buildTaskLogsCard,
  buildStatusCard,
  buildHelpCard,
} from './buildLarkCard.js'
export type { LarkCard, LarkCardElement, LarkCardButton } from './buildLarkCard.js'

export {
  startLarkWsClient,
  stopLarkWsClient,
  isLarkWsClientRunning,
  getLarkClient,
  getDefaultLarkChatId,
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

// ── Task notification bridge ──

export {
  sendTaskCreatedNotification,
  sendTaskCompletionNotify,
} from './sendTaskNotify.js'
export type { TaskNotifyInfo, NodeInfo } from './sendTaskNotify.js'

// ── Lark event routing ──

export {
  createLarkAdapter,
  larkClientContext,
  handleLarkMessage,
  handleCardAction,
  handleP2pChatCreate,
  processMessageEvent,
} from './larkEventRouter.js'
export type { LarkMessageEvent, LarkCardActionEvent, LarkP2pChatCreateEvent } from './larkEventRouter.js'

// ── Lark card markdown ──

export {
  normalizeLarkMarkdown,
  buildMarkdownCard,
  convertMarkdownTables,
} from './larkCardWrapper.js'

// ── Streaming handler ──

export {
  createStreamHandler,
  splitMessage,
  sendFinalResponse,
} from './handlers/streamingHandler.js'
