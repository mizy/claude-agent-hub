/** 飞书 WebSocket 长连接客户端 — 薄适配层 */

import * as Lark from '@larksuiteoapi/node-sdk'
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'
import { loadConfig } from '../config/loadConfig.js'
import { DATA_DIR } from '../store/paths.js'
import { sendApprovalResultNotification, uploadLarkImage, sendLarkImage } from './sendLarkNotify.js'
import { buildWelcomeCard } from './buildLarkCard.js'
import { buildMarkdownCard } from './larkCardWrapper.js'
import { routeMessage } from './handlers/messageRouter.js'
import { dispatchCardAction } from './handlers/larkCardActions.js'
import type { LarkCard } from './buildLarkCard.js'
import type { MessengerAdapter, ClientContext } from './handlers/types.js'

const logger = createLogger('lark-ws')

interface LarkMessageEvent {
  message?: {
    message_id?: string
    message_type?: string
    content?: string
    chat_id?: string
    chat_type?: string
    create_time?: string
    mentions?: Array<{ key: string; id: { open_id?: string }; name: string }>
  }
}

interface LarkCardActionEvent {
  open_chat_id?: string
  open_message_id?: string
  action?: {
    value?: Record<string, unknown>
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
  } catch (error) {
    logger.debug(`Failed to load persisted chatId: ${formatErrorMessage(error)}`)
    return null
  }
}

// Message dedup: prevent SDK from delivering the same message twice
const DEDUP_TTL_MS = 60_000
const recentMessageIds = new Map<string, number>()

// Startup timestamp: ignore messages created before daemon started (prevents re-delivery after restart)
let daemonStartedAt = Date.now()

/** Reset startup timestamp. Call when daemon starts/restarts. */
export function markDaemonStarted(): void {
  daemonStartedAt = Date.now()
}

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

/** Check if message was created before daemon started (stale re-delivery after restart) */
function isStaleMessage(createTime?: string): boolean {
  if (!createTime) return false
  const msgTs = Number(createTime) // Lark create_time is unix ms string
  if (Number.isNaN(msgTs)) return false
  // Allow 3s grace for clock skew and message transit
  return msgTs < daemonStartedAt - 3000
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
        logger.error(`→ reply failed: ${formatErrorMessage(error)}`)
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
        logger.error(`→ send failed: ${formatErrorMessage(error)}`)
        return null
      }
    },
    async editMessage(chatId, messageId, text) {
      if (!larkClient || !messageId) return
      try {
        await larkClient.im.v1.message.patch({
          path: { message_id: messageId },
          data: {
            content: buildMarkdownCard(text),
          },
        })
      } catch (error) {
        const msg = formatErrorMessage(error)
        // Fallback: if original message is not a card, send a new reply instead
        if (msg.includes('NOT a card') || msg.includes('not a card')) {
          logger.warn(`→ edit failed (not a card), falling back to reply: ${messageId}`)
          await this.reply(chatId, text)
        } else {
          logger.error(`→ edit failed: ${msg}`)
        }
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
        logger.error(`→ card send failed: ${formatErrorMessage(error)}`)
      }
    },
    async editCard(chatId: string, messageId: string, card: LarkCard) {
      if (!larkClient || !messageId) return
      try {
        logger.debug(`→ editCard called for msgId=${messageId}`)
        const res = await larkClient.im.v1.message.patch({
          path: { message_id: messageId },
          data: {
            content: JSON.stringify(card),
          },
        })
        logger.debug(`→ editCard response: ${JSON.stringify(res).slice(0, 200)}`)
      } catch (error) {
        const msg = formatErrorMessage(error)
        // Fallback: if original message is not a card, send as new card
        if (msg.includes('NOT a card') || msg.includes('not a card')) {
          logger.warn(`→ editCard failed (not a card), falling back to replyCard: ${messageId}`)
          await this.replyCard!(chatId, card)
        } else {
          logger.error(`→ editCard failed: ${msg}`)
        }
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

// Image message buffer: Lark sends image and text as separate events.
const IMAGE_BUFFER_DELAY_MS = 10_000

interface PendingImage {
  chatId: string
  images: string[]
  isGroup: boolean
  hasMention: boolean
  timer: ReturnType<typeof setTimeout>
}

/** Per-chat pending image buffer */
const pendingImageBuffer = new Map<string, PendingImage>()

function flushPendingImages(chatId: string, text = ''): void {
  const pending = pendingImageBuffer.get(chatId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingImageBuffer.delete(chatId)
  // Fire and forget — handleLarkMessage is async
  handleLarkMessage(chatId, text, pending.isGroup, pending.hasMention, pending.images)
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024 // 20MB

async function downloadLarkImage(messageId: string, imageKey: string): Promise<string | null> {
  if (!larkClient) return null
  try {
    const res = await larkClient.im.v1.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: 'image' },
    })
    // SDK returns a response with file stream
    const fileData = res as unknown as { writeFile(path: string): Promise<void> }
    if (typeof fileData?.writeFile !== 'function') {
      logger.error(`Unexpected messageResource response: ${JSON.stringify(res).slice(0, 200)}`)
      return null
    }
    const filePath = join(tmpdir(), `lark-img-${Date.now()}-${imageKey.slice(-8)}.png`)
    await fileData.writeFile(filePath)

    // Validate file size
    const fileSize = statSync(filePath).size
    if (fileSize > MAX_IMAGE_BYTES) {
      logger.warn(`Image too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB > ${MAX_IMAGE_BYTES / 1024 / 1024}MB`)
      return null
    }

    logger.info(`Downloaded image: ${imageKey} → ${filePath} (${(fileSize / 1024).toFixed(0)}KB)`)
    return filePath
  } catch (error) {
    logger.error(`Failed to download image ${imageKey}: ${formatErrorMessage(error)}`)
    return null
  }
}

async function handleLarkMessage(
  chatId: string,
  text: string,
  isGroup: boolean,
  hasMention: boolean,
  images?: string[]
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
  const imgSuffix = images?.length ? ` +${images.length} image(s)` : ''
  logger.info(`← [${isGroup ? 'group' : 'dm'}] ${preview}${imgSuffix}`)

  await routeMessage({
    chatId,
    text,
    images,
    messenger: createAdapter(),
    clientContext: larkClientContext(isGroup),
    onApprovalResult: await createApprovalCallback(),
    checkBareApproval: true,
  })
}

async function handleCardAction(data: LarkCardActionEvent): Promise<unknown> {
  // SDK v2 flattens event fields: open_chat_id/open_message_id live under context
  const chatId = data?.open_chat_id ?? data?.context?.open_chat_id
  const messageId = data?.open_message_id ?? data?.context?.open_message_id
  const value = data?.action?.value
  if (!chatId || !value) return undefined

  return dispatchCardAction({
    chatId,
    messageId,
    value,
    messenger: createAdapter(),
    onApprovalResult: await createApprovalCallback(),
  })
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
    // API returns { bot: { app_name: "xxx" } } at top level (not under .data)
    const botInfo = res as { bot?: { app_name?: string }; data?: { bot?: { app_name?: string } } }
    larkBotName = botInfo?.bot?.app_name ?? botInfo?.data?.bot?.app_name ?? null
  } catch (error) {
    logger.warn(`Failed to fetch bot name: ${formatErrorMessage(error)}`)
  }

  wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
  })

  const dispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data: LarkMessageEvent) => {
      const message = data.message
      if (!message) return

      const msgType = message.message_type
      if (msgType !== 'text' && msgType !== 'image') return

      const messageId = message.message_id
      if (messageId && isDuplicateMessage(messageId)) {
        logger.debug(`Duplicate message ignored: ${messageId}`)
        return
      }

      // Ignore stale messages re-delivered after daemon restart
      if (isStaleMessage(message.create_time)) {
        logger.info(`Stale message ignored (created before daemon start): ${messageId}`)
        return
      }

      let content: { text?: string; image_key?: string }
      try {
        content = JSON.parse(message.content || '{}')
      } catch {
        logger.debug(`Malformed message content: ${(message.content || '').slice(0, 100)}`)
        return
      }

      const chatId = message.chat_id || ''
      const hasMention = !!(message.mentions && message.mentions.length > 0)
      const isGroup = message.chat_type === 'group'

      if (msgType === 'image') {
        // Skip image-only messages in groups without @mention
        if (isGroup && !hasMention) return

        const imageKey = content.image_key
        if (!imageKey || !messageId) {
          logger.debug('Image message missing image_key or message_id')
          return
        }
        const imagePath = await downloadLarkImage(messageId, imageKey)
        if (!imagePath) {
          const messenger = createAdapter()
          await messenger.reply(chatId, '⚠️ 图片处理失败（可能文件过大或格式不支持），请重试')
          return
        }

        // Buffer image — wait for possible follow-up text from same chat
        const existing = pendingImageBuffer.get(chatId)
        if (existing) {
          // Additional image in same chat — append and reset timer
          clearTimeout(existing.timer)
          existing.images.push(imagePath)
          existing.timer = setTimeout(() => flushPendingImages(chatId), IMAGE_BUFFER_DELAY_MS)
        } else {
          const timer = setTimeout(() => flushPendingImages(chatId), IMAGE_BUFFER_DELAY_MS)
          pendingImageBuffer.set(chatId, { chatId, images: [imagePath], isGroup, hasMention, timer })
        }
        logger.debug(`Image buffered for chat ${chatId}, waiting ${IMAGE_BUFFER_DELAY_MS}ms for text`)
        return
      }

      // Text message — flush any pending images for this chat (merge image + text)
      const text = content.text || ''
      if (pendingImageBuffer.has(chatId)) {
        flushPendingImages(chatId, text)
      } else {
        await handleLarkMessage(chatId, text, isGroup, hasMention)
      }
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
