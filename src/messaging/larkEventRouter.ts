/**
 * Lark event routing — message processing, image buffering, card action dispatch
 *
 * Delegates to:
 * - larkMessageDedup.ts — dedup + stale message filtering
 * - larkAdapter.ts — MessengerAdapter factory
 */

import { statSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../store/paths.js'
import type * as Lark from '@larksuiteoapi/node-sdk'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { getLarkConfig } from '../config/index.js'
import { sendApprovalResultNotification } from './sendLarkNotify.js'
import { buildWelcomeCard } from './buildLarkCard.js'
import { routeMessage } from './handlers/messageRouter.js'
import { dispatchCardAction } from './handlers/larkCardActions.js'
import { isDuplicateMessage, isDuplicateContent, isStaleMessage } from './larkMessageDedup.js'
import type { MessengerAdapter, ClientContext } from './handlers/types.js'

// Re-export for external consumers
export { createLarkAdapter } from './larkAdapter.js'
export {
  isDuplicateMessage,
  isDuplicateContent,
  isStaleMessage,
  markDaemonStarted,
} from './larkMessageDedup.js'

const logger = createLogger('lark-ws')

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
    /** ID of the message being quoted/replied to */
    upper_message_id?: string
    /** Thread parent message ID */
    parent_id?: string
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

// ── File / image limits ──

const IMAGE_BUFFER_DELAY_MS = 10_000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_FILE_BYTES = 50 * 1024 * 1024

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
  handleMessage: (
    chatId: string,
    text: string,
    isGroup: boolean,
    hasMention: boolean,
    images?: string[],
    files?: string[]
  ) => Promise<void>
): Promise<void> {
  const pending = pendingImageBuffer.get(chatId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingImageBuffer.delete(chatId)
  try {
    await handleMessage(chatId, text, pending.isGroup, pending.hasMention, pending.images)
  } catch (error) {
    logger.error(
      `Failed to handle message with images for chat ${chatId}: ${getErrorMessage(error)}`
    )
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
      logger.error(
        `Unexpected messageResource response: ${JSON.stringify(res).slice(0, 200)}`
      )
      return null
    }
    const tmpDir = join(DATA_DIR, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const filePath = join(tmpDir, `lark-img-${Date.now()}-${imageKey.slice(-8)}.png`)
    await fileData.writeFile(filePath)

    const fileSize = statSync(filePath).size
    if (fileSize > MAX_IMAGE_BYTES) {
      logger.warn(
        `Image too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB > ${MAX_IMAGE_BYTES / 1024 / 1024}MB`
      )
      try { unlinkSync(filePath) } catch (e) { logger.debug(`Failed to clean up tmp file ${filePath}: ${getErrorMessage(e)}`) }
      return null
    }

    logger.debug(
      `Downloaded image: ${imageKey} → ${filePath} (${(fileSize / 1024).toFixed(0)}KB)`
    )
    return filePath
  } catch (error) {
    logger.error(`Failed to download image ${imageKey}: ${getErrorMessage(error)}`)
    return null
  }
}

export async function downloadLarkFile(
  larkClient: Lark.Client,
  messageId: string,
  fileKey: string,
  fileName: string
): Promise<string | null> {
  try {
    const res = await larkClient.im.v1.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type: 'file' },
    })
    const fileData = res as unknown as { writeFile(path: string): Promise<void> }
    if (typeof fileData?.writeFile !== 'function') {
      logger.error(`Unexpected file response for key ${fileKey}`)
      return null
    }
    const tmpDir = join(DATA_DIR, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unnamed'
    const filePath = join(tmpDir, `lark-file-${Date.now()}-${safeName}`)
    await fileData.writeFile(filePath)

    const fileSize = statSync(filePath).size
    if (fileSize > MAX_FILE_BYTES) {
      logger.warn(`File too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB > ${MAX_FILE_BYTES / 1024 / 1024}MB`)
      try { unlinkSync(filePath) } catch (e) { logger.debug(`Failed to clean up tmp file ${filePath}: ${getErrorMessage(e)}`) }
      return null
    }

    logger.debug(`Downloaded file: ${fileName} → ${filePath} (${(fileSize / 1024).toFixed(0)}KB)`)
    return filePath
  } catch (error) {
    logger.error(`Failed to download file ${fileName}: ${getErrorMessage(error)}`)
    return null
  }
}

/** Fetch the text content of a quoted/replied-to message by ID */
async function fetchQuotedMessageText(
  larkClient: Lark.Client,
  upperMessageId: string
): Promise<string | null> {
  try {
    const res = await larkClient.im.v1.message.get({
      path: { message_id: upperMessageId },
    }) as unknown as { data?: { items?: Array<{ msg_type?: string; body?: { content?: string } }> } }
    if (!res?.data?.items) {
      logger.warn(`Unexpected response structure from im.v1.message.get for ${upperMessageId}: missing data.items`)
      return null
    }
    const item = res.data.items[0]
    if (!item) return null

    const msgType = item.msg_type
    const rawContent = item.body?.content
    if (!rawContent) return null

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(rawContent)
    } catch {
      return rawContent.slice(0, 500)
    }

    if (msgType === 'text') {
      return (parsed.text as string | undefined)?.slice(0, 500) ?? null
    }
    if (msgType === 'post') {
      const { text } = parsePostContent(parsed)
      return text.slice(0, 500) || null
    }
    return null
  } catch (error) {
    logger.debug(`Failed to fetch quoted message ${upperMessageId}: ${getErrorMessage(error)}`)
    return null
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

/** Wrap adapter so all reply/sendAndGetId calls auto-quote the original message */
function wrapWithReplyQuote(adapter: MessengerAdapter, messageId: string): MessengerAdapter {
  return {
    ...adapter,
    reply: (chatId, text, options?) =>
      adapter.reply(chatId, text, { ...options, replyToMessageId: messageId }),
    sendAndGetId: (chatId, text, options?) =>
      adapter.sendAndGetId(chatId, text, { ...options, replyToMessageId: messageId }),
  }
}

export async function handleLarkMessage(
  chatId: string,
  text: string,
  isGroup: boolean,
  hasMention: boolean,
  adapter: MessengerAdapter,
  botName: string | null,
  onChatIdDiscovered: (chatId: string) => void,
  images?: string[],
  originalMessageId?: string,
  files?: string[]
): Promise<void> {
  if (isGroup && !hasMention) return

  if (!isGroup) {
    onChatIdDiscovered(chatId)
  }

  const imgSuffix = images?.length ? ` +${images.length} image(s)` : ''
  const fileSuffix = files?.length ? ` +${files.length} file(s)` : ''
  logger.info(`← [${isGroup ? 'group' : 'dm'}]${imgSuffix}${fileSuffix}`)

  // In group chats, wrap adapter to quote the original @mention message
  const messenger = isGroup && originalMessageId
    ? wrapWithReplyQuote(adapter, originalMessageId)
    : adapter

  await routeMessage({
    chatId,
    text,
    images,
    files,
    messenger,
    clientContext: larkClientContext(isGroup, botName),
    onApprovalResult: await createApprovalCallback(),
    checkBareApproval: true,
  })
}

export async function handleCardAction(
  data: LarkCardActionEvent,
  adapter: MessengerAdapter
): Promise<unknown> {
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
  // quote element: contains a nested message content
  content?: unknown
}

function parsePostContent(
  content: Record<string, unknown>
): { text: string; imageKeys: string[] } {
  const texts: string[] = []
  const imageKeys: string[] = []

  let postBody: PostElement[][] | undefined
  if (Array.isArray(content.content)) {
    postBody = content.content as PostElement[][]
  } else {
    const locales = Object.values(content) as Array<{ content?: PostElement[][] }>
    postBody = locales.find(
      l => l && typeof l === 'object' && !Array.isArray(l) && Array.isArray(l.content)
    )?.content
  }

  if (!postBody || !Array.isArray(postBody)) {
    logger.debug(
      `parsePostContent: no content array found, keys=${JSON.stringify(Object.keys(content))}`
    )
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
        texts.push(el.text)
      }
      // quote element: skip (quoted context is handled via upper_message_id fetch)
    }
  }

  const result = { text: texts.join(' ').trim(), imageKeys }
  logger.debug(
    `parsePostContent: extracted ${texts.length} text(s), ${imageKeys.length} image(s)`
  )
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

  const SUPPORTED_MSG_TYPES = new Set(['text', 'image', 'post', 'file', 'audio'])
  if (!SUPPORTED_MSG_TYPES.has(msgType ?? '')) {
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

  let content: { text?: string; image_key?: string; file_key?: string; file_name?: string }
  try {
    content = JSON.parse(message.content || '{}')
  } catch {
    logger.debug(`Malformed message content (${(message.content || '').length} chars)`)
    return
  }

  const chatId = message.chat_id || ''
  if (!chatId) {
    logger.debug('Message missing chat_id, skipping')
    return
  }

  const rawContent = message.content || ''
  if (isDuplicateContent(chatId, rawContent)) {
    logger.info(
      `Duplicate content ignored (WS replay): chatId=${chatId.slice(0, 12)} msgId=${messageId}`
    )
    return
  }

  const hasMention = !!(message.mentions && message.mentions.length > 0)
  const isGroup = message.chat_type === 'group'

  // Audio message: reply with friendly unsupported notice (after dedup/stale checks)
  if (msgType === 'audio') {
    if (isGroup && !hasMention) return
    await adapter.reply(chatId, '⚠️ 暂不支持音频消息，请发送文字或文件')
    return
  }

  // Fetch quoted message context (引用回复) if present
  let quotedText: string | null = null
  const upperMsgId = message.upper_message_id
  if (upperMsgId) {
    quotedText = await fetchQuotedMessageText(larkClient, upperMsgId)
    if (quotedText) {
      logger.debug(`Fetched quoted message context (${quotedText.length} chars)`)
    }
  }

  /** Prepend quoted context to text */
  function withQuote(txt: string): string {
    if (!quotedText) return txt
    const quoted = `[引用: ${quotedText}]`
    return txt ? `${quoted}\n\n${txt}` : quoted
  }

  const handleMsg = (
    cId: string,
    txt: string,
    grp: boolean,
    mention: boolean,
    imgs?: string[],
    files?: string[]
  ) => handleLarkMessage(cId, txt, grp, mention, adapter, botName, onChatIdDiscovered, imgs, messageId, files)

  // File message
  if (msgType === 'file') {
    if (isGroup && !hasMention) return

    const fileKey = content.file_key
    const fileName = content.file_name ?? 'file'
    if (!fileKey || !messageId) {
      logger.debug('File message missing file_key or message_id')
      return
    }
    const filePath = await downloadLarkFile(larkClient, messageId, fileKey, fileName)
    if (!filePath) {
      await adapter.reply(chatId, `⚠️ 文件下载失败（${fileName}），可能文件过大或格式不支持`)
      return
    }
    await handleMsg(chatId, withQuote(''), isGroup, hasMention, undefined, [filePath])
    return
  }

  // Rich text (post) message
  if (msgType === 'post') {
    if (isGroup && !hasMention) return
    logger.debug(
      `Post message content keys: ${JSON.stringify(Object.keys(content))}, raw: ${JSON.stringify(content).slice(0, 500)}`
    )
    const { text: postText, imageKeys } = parsePostContent(content)
    const images: string[] = []
    if (messageId) {
      for (const key of imageKeys) {
        const path = await downloadLarkImage(larkClient, messageId, key)
        if (path) images.push(path)
      }
    }
    await handleMsg(chatId, withQuote(postText), isGroup, hasMention, images.length > 0 ? images : undefined)
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

    // If there's a quoted message, flush image immediately with quote context
    if (quotedText) {
      await handleMsg(chatId, withQuote(''), isGroup, hasMention, [imagePath])
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
      pendingImageBuffer.set(chatId, {
        chatId,
        images: [imagePath],
        isGroup,
        hasMention,
        timer,
      })
    }
    logger.debug(
      `Image buffered for chat ${chatId}, waiting ${IMAGE_BUFFER_DELAY_MS}ms for text`
    )
    return
  }

  // Text message
  const text = withQuote(content.text || '')
  if (pendingImageBuffer.has(chatId)) {
    await flushPendingImages(chatId, text, handleMsg)
  } else {
    await handleMsg(chatId, text, isGroup, hasMention)
  }
}
