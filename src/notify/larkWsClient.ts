/**
 * 飞书 WebSocket 长连接客户端
 *
 * 薄适配层：飞书 WSClient 事件接收 + MessengerAdapter 构建
 * 消息路由委托给 handlers/messageRouter，业务逻辑在 handlers/ 下
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../shared/logger.js'
import { loadConfig } from '../config/loadConfig.js'
import { DATA_DIR } from '../store/paths.js'
import { sendApprovalResultNotification, uploadLarkImage, sendLarkImage } from './sendLarkNotify.js'
import { buildWelcomeCard, buildTaskDetailCard, buildTaskLogsCard } from './buildLarkCard.js'
import { buildMarkdownCard } from './larkCardWrapper.js'
import { routeMessage } from './handlers/messageRouter.js'
import { handleApproval } from './handlers/approvalHandler.js'
import { handleList } from './handlers/commandHandler.js'
import { loadTaskFolder } from '../store/TaskWorkflowStore.js'
import { getLogPath } from '../store/TaskLogStore.js'
import { resumeTask } from '../task/resumeTask.js'
import type { LarkCard } from './buildLarkCard.js'
import type { MessengerAdapter, ParsedApproval, ClientContext } from './handlers/types.js'

const logger = createLogger('lark-ws')

// ── Lark SDK event data types ──

interface LarkMessageEvent {
  message?: {
    message_id?: string
    message_type?: string
    content?: string
    chat_id?: string
    chat_type?: string
    mentions?: Array<{ key: string; id: { open_id?: string }; name: string }>
  }
}

interface LarkCardActionEvent {
  open_chat_id?: string
  open_message_id?: string
  action?: {
    value?: Record<string, string>
  }
  context?: {
    open_chat_id?: string
    open_message_id?: string
  }
}

interface LarkP2pChatCreateEvent {
  chat_id?: string
}

interface LarkSdkResponse {
  data?: { message_id?: string }
}

let wsClient: Lark.WSClient | null = null
let larkClient: Lark.Client | null = null
let larkBotName: string | null = null
let defaultLarkChatId: string | null = null

// Persist default chatId so subprocesses can read it for push notifications
const LARK_CHAT_ID_FILE = join(DATA_DIR, 'lark-chat-id')

function persistChatId(chatId: string): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(LARK_CHAT_ID_FILE, chatId, 'utf-8')
  } catch {
    logger.debug('Failed to persist lark chatId')
  }
}

function loadPersistedChatId(): string | null {
  try {
    return readFileSync(LARK_CHAT_ID_FILE, 'utf-8').trim() || null
  } catch {
    return null
  }
}

// Message dedup: prevent SDK from delivering the same message twice
const DEDUP_TTL_MS = 60_000
const recentMessageIds = new Map<string, number>()

function isDuplicateMessage(messageId: string): boolean {
  if (!messageId) return false
  if (recentMessageIds.has(messageId)) return true
  recentMessageIds.set(messageId, Date.now())
  if (recentMessageIds.size > 100) {
    const now = Date.now()
    for (const [id, ts] of recentMessageIds) {
      if (now - ts > DEDUP_TTL_MS) recentMessageIds.delete(id)
    }
  }
  return false
}

// ── MessengerAdapter ──

function createAdapter(): MessengerAdapter {
  return {
    async reply(chatId, text) {
      if (!larkClient) return
      try {
        await larkClient.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            content: buildMarkdownCard(text),
            msg_type: 'interactive',
          },
        })
      } catch (error) {
        logger.error(`→ reply failed: ${error instanceof Error ? error.message : error}`)
      }
    },
    async sendAndGetId(chatId, text) {
      if (!larkClient) return null
      try {
        const res = await larkClient.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            content: buildMarkdownCard(text),
            msg_type: 'interactive',
          },
        })
        return (res as LarkSdkResponse)?.data?.message_id ?? null
      } catch (error) {
        logger.error(`→ send failed: ${error instanceof Error ? error.message : error}`)
        return null
      }
    },
    async editMessage(_chatId, messageId, text) {
      if (!larkClient || !messageId) return
      try {
        await larkClient.im.v1.message.patch({
          path: { message_id: messageId },
          data: {
            content: buildMarkdownCard(text),
          },
        })
      } catch (error) {
        logger.error(`→ edit failed: ${error instanceof Error ? error.message : error}`)
      }
    },
    async replyCard(chatId: string, card: LarkCard) {
      if (!larkClient) return
      try {
        await larkClient.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            content: JSON.stringify(card),
            msg_type: 'interactive',
          },
        })
      } catch (error) {
        logger.error(`→ card send failed: ${error instanceof Error ? error.message : error}`)
      }
    },
    async editCard(_chatId: string, messageId: string, card: LarkCard) {
      if (!larkClient || !messageId) return
      try {
        await larkClient.im.v1.message.patch({
          path: { message_id: messageId },
          data: {
            content: JSON.stringify(card),
          },
        })
      } catch (error) {
        logger.error(`→ editCard failed: ${error instanceof Error ? error.message : error}`)
      }
    },
    async replyImage(chatId: string, imageData: Buffer) {
      if (!larkClient) return
      const imageKey = await uploadLarkImage(larkClient, imageData)
      if (!imageKey) return
      await sendLarkImage(larkClient, chatId, imageKey)
    },
  }
}

// ── Client context ──

function larkClientContext(isGroup: boolean): ClientContext {
  return {
    platform: '飞书 (Lark)',
    maxMessageLength: 10000,
    supportedFormats: ['markdown', 'code block'],
    isGroup,
    botName: larkBotName ?? undefined,
  }
}

// ── Lark approval notification callback ──

async function createApprovalCallback() {
  const cfg = await loadConfig()
  const webhookUrl = cfg.notify?.lark?.webhookUrl
  if (!webhookUrl) return undefined
  return async (result: {
    nodeId: string
    nodeName: string
    approved: boolean
    reason?: string
  }) => {
    await sendApprovalResultNotification(webhookUrl, result)
  }
}

// ── Message handling (delegates to router) ──

async function handleLarkMessage(
  chatId: string,
  text: string,
  isGroup: boolean,
  hasMention: boolean
): Promise<void> {
  // Ignore group messages without @mention
  if (isGroup && !hasMention) return

  // Auto-record default chatId from first DM for push notifications
  if (!isGroup && !defaultLarkChatId) {
    defaultLarkChatId = chatId
    persistChatId(chatId)
    logger.info(`Default Lark chatId recorded: ${chatId}`)
  }

  const preview = text.length > 60 ? text.slice(0, 57) + '...' : text
  logger.info(`← [${isGroup ? 'group' : 'dm'}] ${preview}`)

  await routeMessage({
    chatId,
    text,
    messenger: createAdapter(),
    clientContext: larkClientContext(isGroup),
    onApprovalResult: await createApprovalCallback(),
    checkBareApproval: true,
  })
}

// ── Card action + new chat handlers ──

async function handleCardAction(data: LarkCardActionEvent): Promise<LarkCard | void> {
  // SDK v2 flattens event fields: open_chat_id/open_message_id live under context
  const chatId = data?.open_chat_id ?? data?.context?.open_chat_id
  const messageId = data?.open_message_id ?? data?.context?.open_message_id
  const value = data?.action?.value
  if (!chatId || !value) return

  const actionType = value.action
  logger.info(`← [card] action=${actionType} chatId=${chatId} msgId=${messageId ?? '?'}`)

  if (actionType === 'approve' || actionType === 'reject') {
    const approval: ParsedApproval = {
      action: actionType,
      nodeId: value.nodeId,
    }
    const messenger = createAdapter()
    const result = await handleApproval(approval, await createApprovalCallback())
    logger.info(`→ approval: ${approval.action} ${approval.nodeId ?? '(auto)'}`)
    await messenger.reply(chatId, result)
  } else if (actionType === 'list_page') {
    const page = parseInt(value.page ?? '1', 10) || 1
    const filter = value.filter
    const result = await handleList(filter, page)
    if (result.larkCard) {
      // Also edit via API as fallback (in case SDK callback response doesn't update card)
      if (messageId) {
        const messenger = createAdapter()
        await messenger.editCard?.(chatId, messageId, result.larkCard)
      }
      // Return card to update in-place via SDK callback response
      return result.larkCard
    }
    const messenger = createAdapter()
    await messenger.reply(chatId, result.text)
  } else if (actionType === 'task_detail') {
    const taskId = value.taskId
    if (!taskId) {
      logger.warn('task_detail action missing taskId')
      return
    }
    const messenger = createAdapter()
    const folder = loadTaskFolder(taskId)
    if (!folder) {
      await messenger.reply(chatId, `未找到任务: ${taskId}`)
      return
    }
    const card = buildTaskDetailCard(folder.task, folder.instance, folder.workflow)
    await messenger.replyCard?.(chatId, card)
  } else if (actionType === 'task_logs') {
    const taskId = value.taskId
    if (!taskId) {
      logger.warn('task_logs action missing taskId')
      return
    }
    const messenger = createAdapter()
    const logPath = getLogPath(taskId)
    let content: string
    try {
      content = readFileSync(logPath, 'utf-8')
    } catch {
      await messenger.reply(chatId, `暂无日志: ${taskId.slice(0, 20)}`)
      return
    }
    const lines = content.trim().split('\n')
    const tail = lines.slice(-50).join('\n')
    const card = buildTaskLogsCard(taskId, tail)
    await messenger.replyCard?.(chatId, card)
  } else if (actionType === 'task_retry') {
    const taskId = value.taskId
    if (!taskId) {
      logger.warn('task_retry action missing taskId')
      return
    }
    const messenger = createAdapter()
    try {
      const pid = resumeTask(taskId)
      if (pid) {
        logger.info(`→ task retried: ${taskId.slice(0, 20)} pid=${pid}`)
        await messenger.reply(chatId, `▶️ 已恢复任务: \`${taskId.slice(0, 20)}\`\nPID: ${pid}`)
      } else {
        await messenger.reply(chatId, `⚠️ 无法恢复任务（可能仍在运行或已完成）`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error(`task_retry failed: ${msg}`)
      await messenger.reply(chatId, `❌ 恢复任务失败: ${msg}`)
    }
  } else {
    logger.warn(`Unknown card action: ${actionType}`)
  }
}

async function handleP2pChatCreate(data: LarkP2pChatCreateEvent): Promise<void> {
  const chatId = data?.chat_id
  if (!chatId) return

  if (!defaultLarkChatId) {
    defaultLarkChatId = chatId
    persistChatId(chatId)
    logger.info(`Default Lark chatId recorded: ${chatId}`)
  }

  const messenger = createAdapter()
  if (messenger.replyCard) {
    await messenger.replyCard(chatId, buildWelcomeCard())
  } else {
    await messenger.reply(chatId, '欢迎使用 Claude Agent Hub! 发送 /help 查看指令')
  }
}

// ── Public API ──

export async function startLarkWsClient(): Promise<void> {
  if (wsClient) {
    logger.warn('Lark WebSocket client already running')
    return
  }

  const config = await loadConfig()
  const { appId, appSecret } = config.notify?.lark || {}

  if (!appId || !appSecret) {
    throw new Error('Missing Lark appId or appSecret in config')
  }

  const baseConfig = { appId, appSecret }
  larkClient = new Lark.Client(baseConfig)

  // Fetch bot name
  try {
    const res = await larkClient.request({
      method: 'GET',
      url: '/open-apis/bot/v3/info/',
    })
    const botInfo = res as { data?: { bot?: { app_name?: string } } }
    larkBotName = botInfo?.data?.bot?.app_name ?? null
  } catch (error) {
    logger.debug(`Failed to fetch bot name: ${error instanceof Error ? error.message : error}`)
  }

  wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
  })

  const dispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data: LarkMessageEvent) => {
      const message = data.message
      if (!message) return
      if (message.message_type !== 'text') return

      const messageId = message.message_id
      if (messageId && isDuplicateMessage(messageId)) {
        logger.debug(`Duplicate message ignored: ${messageId}`)
        return
      }

      let content: { text?: string }
      try {
        content = JSON.parse(message.content || '{}')
      } catch {
        logger.debug(`Malformed message content: ${(message.content || '').slice(0, 100)}`)
        return
      }

      const text = content.text || ''
      const chatId = message.chat_id || ''
      const hasMention = !!(message.mentions && message.mentions.length > 0)
      const isGroup = message.chat_type === 'group'

      await handleLarkMessage(chatId, text, isGroup, hasMention)
    },
  })

  // Card button callback
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lark SDK lacks type defs for card actions
    dispatcher.register({ 'card.action.trigger': handleCardAction } as any)
  } catch {
    logger.warn('card.action.trigger registration not supported by SDK, skipping')
  }

  // New chat created (welcome message)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lark SDK lacks type defs for this event
    dispatcher.register({ p2p_chat_create: handleP2pChatCreate } as any)
  } catch {
    logger.warn('p2p_chat_create registration not supported by SDK, skipping')
  }

  // Log-only events
  const logEvent = (name: string) => async (data: unknown) => {
    logger.info(`← [event] ${name}: ${JSON.stringify(data).slice(0, 120)}`)
  }
  try {
    dispatcher.register({
      'im.message.reaction.created_v1': logEvent('reaction.created'),
      'im.message.reaction.deleted_v1': logEvent('reaction.deleted'),
      'im.message.recalled_v1': logEvent('message.recalled'),
      'im.chat.member.user.added_v1': logEvent('chat.member.added'),
      'im.message.bot_muted_v1': logEvent('bot.muted'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lark SDK lacks type defs for these events
    } as any)
  } catch {
    logger.debug('Some log-only event registrations not supported, skipping')
  }

  wsClient.start({ eventDispatcher: dispatcher })

  logger.info(`Lark WebSocket client started${larkBotName ? ` as "${larkBotName}"` : ''}`)
}

export async function stopLarkWsClient(): Promise<void> {
  if (!wsClient) return
  wsClient.close()
  wsClient = null
  larkClient = null
  larkBotName = null
  defaultLarkChatId = null
  logger.info('Lark WebSocket client stopped')
}

export function getLarkClient(): Lark.Client | null {
  return larkClient
}

export function isLarkWsClientRunning(): boolean {
  return wsClient !== null
}

export function getDefaultLarkChatId(): string | null {
  if (defaultLarkChatId) return defaultLarkChatId
  // Subprocess fallback: read from persisted file
  return loadPersistedChatId()
}
