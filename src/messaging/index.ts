/**
 * @entry Messaging IM 交互层
 *
 * 平台无关的消息处理 + 飞书/Telegram 适配层 + 任务通知桥接
 *
 * 能力分组：
 * - 消息路由: routeMessage/parseCommandText — 命令分发 + 对话 + 审批
 * - 命令处理: handleCommand/handleRun/handleList/handleLogs/handleStop/... (12 个命令)
 * - 对话: handleChat/clearChatSession/getChatSessionInfo/destroyChatHandler
 * - 审批: handleApproval/parseApprovalCommand
 * - 会话管理: loadSessions/configureSession
 * - 飞书客户端: startLarkWsClient/stopLarkWsClient/getLarkClient
 * - 飞书消息: sendLarkMessage/sendLarkCardViaApi/updateLarkCard/uploadLarkImage
 * - 飞书卡片: buildCard/buildTaskCompletedCard/buildTaskListCard/... (10 种卡片)
 * - 飞书事件路由: createLarkAdapter/handleLarkMessage/handleCardAction/processMessageEvent
 * - 飞书 Markdown: normalizeLarkMarkdown/buildMarkdownCard/convertMarkdownTables
 * - Telegram 客户端: startTelegramClient/stopTelegramClient/sendTelegramMessage
 * - Telegram 通知: sendTelegramReviewNotification/sendTelegramTextMessage
 * - 任务通知桥接: sendTaskCreatedNotification/sendTaskCompletionNotify
 * - 事件监听: registerTaskEventListeners (task 事件 → IM 通知)
 * - 情景记忆: triggerEpisodeOnTaskCreation/flushEpisode/clearEpisodeTracker
 * - 流式处理: createStreamHandler/splitMessage/sendFinalResponse
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
export { loadSessions, configureSession } from './handlers/sessionManager.js'
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

// ── Task event listeners (call at startup to bridge events → notifications) ──

export { registerTaskEventListeners } from './registerTaskEventListeners.js'

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

// ── Episode extractor ──

export { triggerEpisodeOnTaskCreation, flushEpisode, clearEpisodeTracker } from './handlers/episodeExtractor.js'

// ── Streaming handler ──

export {
  createStreamHandler,
  splitMessage,
  sendFinalResponse,
} from './handlers/streamingHandler.js'
