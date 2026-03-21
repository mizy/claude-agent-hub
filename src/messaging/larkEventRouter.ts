/**
 * Lark event routing — message processing, card action dispatch
 *
 * Delegates to:
 * - larkMessageDedup.ts — dedup + stale message filtering
 * - larkAdapter.ts — MessengerAdapter factory
 * - larkImageBuffer.ts — image/file download + pending image buffer
 * - larkGroupBuffer.ts — group message aggregation buffer
 */

import type * as Lark from '@larksuiteoapi/node-sdk'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { getLarkConfig } from '../config/index.js'
import { sendApprovalResultNotification } from './sendLarkNotify.js'
import { buildWelcomeCard } from './buildLarkCard.js'
import { routeMessage } from './handlers/messageRouter.js'
import { dispatchCardAction } from './handlers/larkCardActions.js'
import { isDuplicateMessage, isDuplicateContent, isStaleMessage } from './larkMessageDedup.js'
import { downloadLarkImage, downloadLarkFile, bufferImage, hasPendingImages, flushPendingImages } from './larkImageBuffer.js'
import { addToGroupBuffer, setHandleLarkMessage } from './larkGroupBuffer.js'
import type { MessengerAdapter, ClientContext } from './handlers/types.js'
import type { LarkConfig } from '../config/schema.js'

// Re-export for external consumers
export { createLarkAdapter } from './larkAdapter.js'
export {
  isDuplicateMessage,
  isDuplicateContent,
  isStaleMessage,
  markDaemonStarted,
} from './larkMessageDedup.js'
export { downloadLarkImage, downloadLarkFile } from './larkImageBuffer.js'
export { destroyGroupBuffer } from './larkGroupBuffer.js'

const logger = createLogger('lark-ws')

const SUPPORTED_MSG_TYPES = new Set(['text', 'image', 'post', 'file', 'audio'])

// ── Access control ──

function checkLarkAccess(
  chatId: string,
  senderOpenId: string | undefined,
  ac: LarkConfig['accessControl']
): boolean {
  if (!ac || ac.mode === 'open') return true
  if (ac.allowedChats?.length && ac.allowedChats.includes(chatId)) return true
  if (senderOpenId && ac.allowedUsers?.length && ac.allowedUsers.includes(senderOpenId)) return true

  logger.info(`Access denied: chatId=...${chatId.slice(-6)} sender=...${senderOpenId?.slice(-6) ?? 'unknown'}`)
  logger.debug(`Access denied (full): chatId=${chatId} sender=${senderOpenId ?? 'unknown'}`)
  return false
}

// ── Event types ──

export interface LarkMessageEvent {
  sender?: {
    sender_id?: {
      open_id?: string
      user_id?: string
      union_id?: string
    }
    sender_type?: string
  }
  message?: {
    message_id?: string
    message_type?: string
    content?: string
    chat_id?: string
    chat_type?: string
    create_time?: string
    mentions?: Array<{ key: string; id: { open_id?: string }; name: string }>
    upper_message_id?: string
    parent_id?: string
  }
}

export interface LarkCardActionEvent {
  open_chat_id?: string
  open_message_id?: string
  operator?: {
    open_id?: string
  }
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

function wrapWithReplyQuote(adapter: MessengerAdapter, messageId: string, senderOpenId?: string): MessengerAdapter {
  const baseMentions = senderOpenId ? [{ userId: senderOpenId, name: '' }] : []
  return {
    ...adapter,
    reply: (chatId, text, options?) =>
      adapter.reply(chatId, text, {
        ...options,
        replyToMessageId: messageId,
        mentions: [...baseMentions, ...(options?.mentions ?? [])],
      }),
    sendAndGetId: (chatId, text, options?) =>
      adapter.sendAndGetId(chatId, text, {
        ...options,
        replyToMessageId: messageId,
        mentions: [...baseMentions, ...(options?.mentions ?? [])],
      }),
  }
}

export interface LarkMessageOptions {
  chatId: string
  text: string
  isGroup: boolean
  hasMention: boolean
  adapter: MessengerAdapter
  botName: string | null
  onChatIdDiscovered: (chatId: string) => void
  images?: string[]
  originalMessageId?: string
  files?: string[]
  senderOpenId?: string
}

export async function handleLarkMessage(opts: LarkMessageOptions): Promise<void> {
  const { chatId, text, isGroup, hasMention, adapter, botName, onChatIdDiscovered, images, files, originalMessageId, senderOpenId } = opts
  if (isGroup && !hasMention) return

  if (!isGroup) {
    onChatIdDiscovered(chatId)
  }

  const imgSuffix = images?.length ? ` +${images.length} image(s)` : ''
  const fileSuffix = files?.length ? ` +${files.length} file(s)` : ''
  logger.info(`← [${isGroup ? 'group' : 'dm'}]${imgSuffix}${fileSuffix}`)

  const messenger = isGroup && originalMessageId
    ? wrapWithReplyQuote(adapter, originalMessageId, senderOpenId)
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

// Register handleLarkMessage with group buffer so it can flush back to us
setHandleLarkMessage(handleLarkMessage)

export async function handleCardAction(
  data: LarkCardActionEvent,
  adapter: MessengerAdapter
): Promise<unknown> {
  const chatId = data?.context?.open_chat_id ?? data?.open_chat_id
  const messageId = data?.context?.open_message_id ?? data?.open_message_id
  const value = data?.action?.value
  if (!chatId || !value) return undefined

  const operatorOpenId = data?.operator?.open_id
  const larkConfig = await getLarkConfig()
  if (!checkLarkAccess(chatId, operatorOpenId, larkConfig?.accessControl)) return undefined

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
    }
  }

  const result = { text: texts.join(' ').trim(), imageKeys }
  logger.debug(
    `parsePostContent: extracted ${texts.length} text(s), ${imageKeys.length} image(s)`
  )
  return result
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

  const senderOpenId = data.sender?.sender_id?.open_id
  const larkConfig = await getLarkConfig()
  if (!checkLarkAccess(chatId, senderOpenId, larkConfig?.accessControl)) return

  if (!messageId) {
    const rawContent = message.content || ''
    if (isDuplicateContent(chatId, rawContent)) {
      logger.info(
        `Duplicate content ignored (no msgId, hash dedup): chatId=${chatId.slice(0, 12)}`
      )
      return
    }
  }

  const hasMention = !!(message.mentions?.length && (
    !botName || message.mentions.some(m => m.name === botName)
  ))
  const isGroup = message.chat_type === 'group'

  if (msgType === 'audio') {
    if (isGroup && !hasMention) return
    await adapter.reply(chatId, '⚠️ 暂不支持音频消息，请发送文字或文件')
    return
  }

  // Fetch quoted message context
  let quotedText: string | null = null
  const upperMsgId = message.upper_message_id
  if (upperMsgId) {
    quotedText = await fetchQuotedMessageText(larkClient, upperMsgId)
    if (quotedText) {
      logger.debug(`Fetched quoted message context (${quotedText.length} chars)`)
    }
  }

  function withQuote(txt: string): string {
    if (!quotedText) return txt
    const quoted = `[引用: ${quotedText}]`
    return txt ? `${quoted}\n\n${txt}` : quoted
  }

  const directHandleMsg = (
    cId: string,
    txt: string,
    grp: boolean,
    mention: boolean,
    imgs?: string[],
    files?: string[]
  ) => handleLarkMessage({
    chatId: cId, text: txt, isGroup: grp, hasMention: mention,
    adapter, botName, onChatIdDiscovered,
    images: imgs, originalMessageId: messageId, files, senderOpenId,
  })

  const handleMsg = isGroup && hasMention
    ? (cId: string, txt: string, _grp: boolean, _mention: boolean, imgs?: string[], files?: string[]) => {
        addToGroupBuffer(cId, txt, adapter, botName, onChatIdDiscovered, imgs, files, senderOpenId, messageId)
        return Promise.resolve()
      }
    : directHandleMsg

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

  // Image message
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

    if (quotedText) {
      await handleMsg(chatId, withQuote(''), isGroup, hasMention, [imagePath])
      return
    }

    bufferImage(chatId, imagePath, isGroup, hasMention, handleMsg)
    return
  }

  // Text message
  const text = withQuote(content.text || '')
  if (hasPendingImages(chatId)) {
    await flushPendingImages(chatId, text, handleMsg)
  } else {
    await handleMsg(chatId, text, isGroup, hasMention)
  }
}
