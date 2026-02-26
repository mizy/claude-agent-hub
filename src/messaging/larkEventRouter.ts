/**
 * Lark event routing — message processing, image buffering, card action dispatch
 *
 * Separated from larkWsClient to isolate event handling logic from WS connection management.
 */

import { statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type * as Lark from '@larksuiteoapi/node-sdk'
import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'
import { getErrorMessage } from '../shared/assertError.js'
import { getLarkConfig } from '../config/index.js'
import { sendApprovalResultNotification, uploadLarkImage, sendLarkImage } from './sendLarkNotify.js'
import { buildWelcomeCard } from './buildLarkCard.js'
import { buildMarkdownCard } from './larkCardWrapper.js'
import { routeMessage } from './handlers/messageRouter.js'
import { dispatchCardAction } from './handlers/larkCardActions.js'
import { logUserMessage } from './conversationLogger.js'
import type { LarkCard } from './buildLarkCard.js'
import type { MessengerAdapter, ClientContext } from './handlers/types.js'

const logger = createLogger('lark-ws')

/** Simple retry for transient Lark API failures (network, TLS disconnect) */
async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 1): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < maxRetries) {
        const delay = 500 * (attempt + 1)
        logger.debug(`${label} attempt ${attempt + 1} failed, retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

// ── Event types ──

export interface LarkMessageEvent {
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

export interface LarkCardActionEvent {
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

export interface LarkP2pChatCreateEvent {
  chat_id?: string
}

interface LarkSdkResponse {
  data?: { message_id?: string }
}

// ── Message dedup ──

const DEDUP_TTL_MS = 60_000
const DEDUP_MAX_SIZE = 200
const recentMessageIds = new Map<string, number>()

export function isDuplicateMessage(messageId: string): boolean {
  if (!messageId) return false
  if (recentMessageIds.has(messageId)) return true

  // Evict expired entries when approaching capacity
  if (recentMessageIds.size >= DEDUP_MAX_SIZE) {
    const now = Date.now()
    for (const [id, ts] of recentMessageIds) {
      if (now - ts > DEDUP_TTL_MS) recentMessageIds.delete(id)
    }
    // If still full after eviction, drop oldest half (Map iterates in insertion order)
    if (recentMessageIds.size >= DEDUP_MAX_SIZE) {
      const dropCount = Math.floor(DEDUP_MAX_SIZE / 2)
      let i = 0
      for (const id of recentMessageIds.keys()) {
        if (i++ >= dropCount) break
        recentMessageIds.delete(id)
      }
    }
  }

  recentMessageIds.set(messageId, Date.now())
  return false
}

// Content-based dedup: catches WS reconnection replays with different message_ids
const CONTENT_DEDUP_TTL_MS = 120_000
const recentContentHashes = new Map<string, number>()

/** Check if same chatId+content was seen recently (WS reconnect redelivery) */
export function isDuplicateContent(chatId: string, content: string): boolean {
  const key = `${chatId}:${simpleHash(content)}`
  const now = Date.now()
  const prev = recentContentHashes.get(key)
  if (prev && now - prev < CONTENT_DEDUP_TTL_MS) {
    return true
  }

  // Evict expired entries
  if (recentContentHashes.size >= DEDUP_MAX_SIZE) {
    for (const [k, ts] of recentContentHashes) {
      if (now - ts > CONTENT_DEDUP_TTL_MS) recentContentHashes.delete(k)
    }
  }

  recentContentHashes.set(key, now)
  return false
}

/** Simple string hash (FNV-1a 32-bit) */
function simpleHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h
}

// ── Stale message filtering ──

let daemonStartedAt = Date.now()

export function markDaemonStarted(): void {
  daemonStartedAt = Date.now()
}

export function isStaleMessage(createTime?: string): boolean {
  if (!createTime) return false
  const msgTs = Number(createTime)
  if (Number.isNaN(msgTs)) return false
  return msgTs < daemonStartedAt - 3000
}

// ── Image buffering ──

const IMAGE_BUFFER_DELAY_MS = 10_000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

interface PendingImage {
  chatId: string
  images: string[]
  isGroup: boolean
  hasMention: boolean
  timer: ReturnType<typeof setTimeout>
}

const pendingImageBuffer = new Map<string, PendingImage>()

async function flushPendingImages(
  chatId: string,
  text: string,
  handleMessage: (chatId: string, text: string, isGroup: boolean, hasMention: boolean, images?: string[]) => Promise<void>
): Promise<void> {
  const pending = pendingImageBuffer.get(chatId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingImageBuffer.delete(chatId)
  try {
    await handleMessage(chatId, text, pending.isGroup, pending.hasMention, pending.images)
  } catch (error) {
    logger.error(`Failed to handle message with images for chat ${chatId}: ${getErrorMessage(error)}`)
  }
}

export async function downloadLarkImage(
  larkClient: Lark.Client,
  messageId: string,
  imageKey: string
): Promise<string | null> {
  try {
    const res = await larkClient.im.v1.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: 'image' },
    })
    const fileData = res as unknown as { writeFile(path: string): Promise<void> }
    if (typeof fileData?.writeFile !== 'function') {
      logger.error(`Unexpected messageResource response: ${JSON.stringify(res).slice(0, 200)}`)
      return null
    }
    const filePath = join(tmpdir(), `lark-img-${Date.now()}-${imageKey.slice(-8)}.png`)
    await fileData.writeFile(filePath)

    const fileSize = statSync(filePath).size
    if (fileSize > MAX_IMAGE_BYTES) {
      logger.warn(`Image too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB > ${MAX_IMAGE_BYTES / 1024 / 1024}MB`)
      return null
    }

    logger.debug(`Downloaded image: ${imageKey} → ${filePath} (${(fileSize / 1024).toFixed(0)}KB)`)
    return filePath
  } catch (error) {
    logger.error(`Failed to download image ${imageKey}: ${formatErrorMessage(error)}`)
    return null
  }
}

// ── MessengerAdapter factory ──

export function createLarkAdapter(larkClient: Lark.Client): MessengerAdapter {
  return {
    async reply(chatId, text) {
      try {
        await withRetry(
          () => larkClient.im.v1.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
              receive_id: chatId,
              content: buildMarkdownCard(text),
              msg_type: 'interactive',
            },
          }),
          'reply'
        )
      } catch (error) {
        logger.error(`→ reply failed: ${formatErrorMessage(error)}`)
      }
    },
    async sendAndGetId(chatId, text) {
      try {
        const res = await withRetry(
          () => larkClient.im.v1.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
              receive_id: chatId,
              content: buildMarkdownCard(text),
              msg_type: 'interactive',
            },
          }),
          'sendAndGetId'
        )
        return (res as LarkSdkResponse)?.data?.message_id ?? null
      } catch (error) {
        logger.error(`→ send failed: ${formatErrorMessage(error)}`)
        return null
      }
    },
    async editMessage(chatId, messageId, text) {
      if (!messageId) return
      try {
        await withRetry(
          () => larkClient.im.v1.message.patch({
            path: { message_id: messageId },
            data: {
              content: buildMarkdownCard(text),
            },
          }),
          'editMessage'
        )
      } catch (error) {
        const msg = formatErrorMessage(error)
        if (msg.includes('NOT a card') || msg.includes('not a card')) {
          logger.warn(`→ edit failed (not a card), falling back to reply: ${messageId}`)
          await this.reply(chatId, text)
        } else if (msg.includes('400')) {
          // 400 is common during streaming (message deleted, content unchanged, etc.)
          logger.debug(`→ edit skipped (400): ${messageId}`)
        } else {
          logger.error(`→ edit failed: ${msg}`)
        }
      }
    },
    async replyCard(chatId: string, card: LarkCard) {
      try {
        await withRetry(
          () => larkClient.im.v1.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
              receive_id: chatId,
              content: JSON.stringify(card),
              msg_type: 'interactive',
            },
          }),
          'replyCard'
        )
      } catch (error) {
        logger.error(`→ card send failed: ${formatErrorMessage(error)}`)
      }
    },
    async editCard(chatId: string, messageId: string, card: LarkCard) {
      if (!messageId) return
      try {
        logger.debug(`→ editCard called for msgId=${messageId}`)
        const res = await withRetry(
          () => larkClient.im.v1.message.patch({
            path: { message_id: messageId },
            data: {
              content: JSON.stringify(card),
            },
          }),
          'editCard'
        )
        logger.debug(`→ editCard response: code=${res?.code}`)
      } catch (error) {
        const msg = formatErrorMessage(error)
        if (msg.includes('NOT a card') || msg.includes('not a card')) {
          logger.warn(`→ editCard failed (not a card), falling back to replyCard: ${messageId}`)
          await this.replyCard!(chatId, card)
        } else {
          logger.error(`→ editCard failed: ${msg}`)
        }
      }
    },
    async replyImage(chatId: string, imageData: Buffer) {
      const imageKey = await uploadLarkImage(larkClient, imageData)
      if (!imageKey) return
      await sendLarkImage(larkClient, chatId, imageKey)
    },
  }
}

// ── Client context ──

export function larkClientContext(isGroup: boolean, botName: string | null): ClientContext {
  return {
    platform: '飞书 (Lark)',
    maxMessageLength: 10000,
    supportedFormats: ['markdown', 'code block'],
    isGroup,
    botName: botName ?? undefined,
  }
}

// ── Approval callback factory ──

export async function createApprovalCallback() {
  const larkConfig = await getLarkConfig()
  const webhookUrl = larkConfig?.webhookUrl
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

// ── Event handlers ──

export async function handleLarkMessage(
  chatId: string,
  text: string,
  isGroup: boolean,
  hasMention: boolean,
  adapter: MessengerAdapter,
  botName: string | null,
  onChatIdDiscovered: (chatId: string) => void,
  images?: string[]
): Promise<void> {
  if (isGroup && !hasMention) return

  if (!isGroup) {
    onChatIdDiscovered(chatId)
  }

  const imgSuffix = images?.length ? ` +${images.length} image(s)` : ''
  logger.info(`← [${isGroup ? 'group' : 'dm'}]${imgSuffix}`)
  logUserMessage('lark', chatId, text || (images?.length ? '[图片消息]' : ''))

  await routeMessage({
    chatId,
    text,
    images,
    messenger: adapter,
    clientContext: larkClientContext(isGroup, botName),
    onApprovalResult: await createApprovalCallback(),
    checkBareApproval: true,
  })
}

export async function handleCardAction(
  data: LarkCardActionEvent,
  adapter: MessengerAdapter
): Promise<unknown> {
  // Lark SDK v2 events put these under `context`; fall back to top-level for compat
  const chatId = data?.context?.open_chat_id ?? data?.open_chat_id
  const messageId = data?.context?.open_message_id ?? data?.open_message_id
  const value = data?.action?.value
  if (!chatId || !value) return undefined

  return dispatchCardAction({
    chatId,
    messageId,
    value,
    messenger: adapter,
    onApprovalResult: await createApprovalCallback(),
  })
}

export async function handleP2pChatCreate(
  data: LarkP2pChatCreateEvent,
  adapter: MessengerAdapter,
  onChatIdDiscovered: (chatId: string) => void
): Promise<void> {
  const chatId = data?.chat_id
  if (!chatId) return

  onChatIdDiscovered(chatId)

  if (adapter.replyCard) {
    await adapter.replyCard(chatId, buildWelcomeCard())
  } else {
    await adapter.reply(chatId, '欢迎使用 Claude Agent Hub! 发送 /help 查看指令')
  }
}

// ── Post (rich text) content parser ──

interface PostElement {
  tag?: string
  text?: string
  image_key?: string
  href?: string
}

/** Extract plain text and image keys from a Lark post (rich text) message content */
function parsePostContent(content: Record<string, unknown>): { text: string; imageKeys: string[] } {
  const texts: string[] = []
  const imageKeys: string[] = []

  // Post content can be:
  // 1. Locale-wrapped: { zh_cn: { title: "", content: [[...]] } }
  // 2. Flat: { title: "", content: [[...]] }
  let postBody: PostElement[][] | undefined

  // Try flat structure first (content at top level)
  if (Array.isArray(content.content)) {
    postBody = content.content as PostElement[][]
  } else {
    // Try locale-wrapped structure
    const locales = Object.values(content) as Array<{ content?: PostElement[][] }>
    postBody = locales.find(l => l && typeof l === 'object' && !Array.isArray(l) && Array.isArray(l.content))?.content
  }

  if (!postBody || !Array.isArray(postBody)) {
    logger.debug(`parsePostContent: no content array found, keys=${JSON.stringify(Object.keys(content))}`)
    return { text: '', imageKeys: [] }
  }

  for (const paragraph of postBody) {
    if (!Array.isArray(paragraph)) continue
    for (const el of paragraph) {
      if (el.tag === 'text' && el.text) {
        texts.push(el.text)
      } else if (el.tag === 'img' && el.image_key) {
        imageKeys.push(el.image_key)
      } else if (el.tag === 'a' && el.text) {
        // Hyperlink elements also carry text
        texts.push(el.text)
      }
    }
  }

  const result = { text: texts.join(' ').trim(), imageKeys }
  logger.debug(`parsePostContent: extracted ${texts.length} text(s), ${imageKeys.length} image(s)`)
  return result
}

// ── Message event processor (called from WS client) ──

export async function processMessageEvent(
  data: LarkMessageEvent,
  larkClient: Lark.Client,
  adapter: MessengerAdapter,
  botName: string | null,
  onChatIdDiscovered: (chatId: string) => void
): Promise<void> {
  const message = data.message
  if (!message) return

  const msgType = message.message_type
  if (msgType !== 'text' && msgType !== 'image' && msgType !== 'post') {
    logger.debug(`Unsupported message type: ${msgType}`)
    return
  }

  const messageId = message.message_id
  if (messageId && isDuplicateMessage(messageId)) {
    logger.debug(`Duplicate message ignored: ${messageId}`)
    return
  }

  if (isStaleMessage(message.create_time)) {
    logger.debug(`Stale message ignored (created before daemon start): ${messageId}`)
    return
  }

  let content: { text?: string; image_key?: string }
  try {
    content = JSON.parse(message.content || '{}')
  } catch {
    logger.debug(`Malformed message content (${(message.content || '').length} chars)`)
    return
  }

  const chatId = message.chat_id || ''

  // Content-based dedup: catches WS reconnection replays with different message_ids
  const rawContent = message.content || ''
  if (chatId && isDuplicateContent(chatId, rawContent)) {
    logger.info(`Duplicate content ignored (WS replay): chatId=${chatId.slice(0, 12)} msgId=${messageId}`)
    return
  }

  const hasMention = !!(message.mentions && message.mentions.length > 0)
  const isGroup = message.chat_type === 'group'

  const handleMsg = (cId: string, txt: string, grp: boolean, mention: boolean, imgs?: string[]) =>
    handleLarkMessage(cId, txt, grp, mention, adapter, botName, onChatIdDiscovered, imgs)

  // Rich text (post) message — extract text and images, process as combined message
  if (msgType === 'post') {
    if (isGroup && !hasMention) return
    logger.debug(`Post message content keys: ${JSON.stringify(Object.keys(content))}, raw: ${JSON.stringify(content).slice(0, 500)}`)
    const { text: postText, imageKeys } = parsePostContent(content)
    const images: string[] = []
    if (messageId) {
      for (const key of imageKeys) {
        const path = await downloadLarkImage(larkClient, messageId, key)
        if (path) images.push(path)
      }
    }
    await handleMsg(chatId, postText, isGroup, hasMention, images.length > 0 ? images : undefined)
    return
  }

  if (msgType === 'image') {
    if (isGroup && !hasMention) return

    const imageKey = content.image_key
    if (!imageKey || !messageId) {
      logger.debug('Image message missing image_key or message_id')
      return
    }
    const imagePath = await downloadLarkImage(larkClient, messageId, imageKey)
    if (!imagePath) {
      await adapter.reply(chatId, '⚠️ 图片处理失败（可能文件过大或格式不支持），请重试')
      return
    }

    const existing = pendingImageBuffer.get(chatId)
    if (existing) {
      clearTimeout(existing.timer)
      existing.images.push(imagePath)
      existing.timer = setTimeout(() => {
        flushPendingImages(chatId, '', handleMsg).catch(e => {
          logger.error(`Failed to flush pending images on timeout: ${getErrorMessage(e)}`)
        })
      }, IMAGE_BUFFER_DELAY_MS)
    } else {
      const timer = setTimeout(() => {
        flushPendingImages(chatId, '', handleMsg).catch(e => {
          logger.error(`Failed to flush pending images on timeout: ${getErrorMessage(e)}`)
        })
      }, IMAGE_BUFFER_DELAY_MS)
      pendingImageBuffer.set(chatId, { chatId, images: [imagePath], isGroup, hasMention, timer })
    }
    logger.debug(`Image buffered for chat ${chatId}, waiting ${IMAGE_BUFFER_DELAY_MS}ms for text`)
    return
  }

  // Text message
  const text = content.text || ''
  if (pendingImageBuffer.has(chatId)) {
    await flushPendingImages(chatId, text, handleMsg)
  } else {
    await handleMsg(chatId, text, isGroup, hasMention)
  }
}
