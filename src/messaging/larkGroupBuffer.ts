/**
 * Lark group message aggregation buffer
 *
 * Aggregates multiple @mention messages in group chats within a short window,
 * then flushes them as a single combined message for AI processing.
 */

import { unlinkSync } from 'fs'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { MessengerAdapter } from './handlers/types.js'

const logger = createLogger('lark-group-buffer')

const GROUP_BUFFER_DELAY_MS = 3_000
const GROUP_BUFFER_MAX_MESSAGES = 5

interface BufferedGroupMessage {
  senderOpenId?: string
  text: string
  images?: string[]
  files?: string[]
  messageId?: string
}

interface PendingGroupChat {
  messages: BufferedGroupMessage[]
  timer: ReturnType<typeof setTimeout>
  adapter: MessengerAdapter
  botName: string | null
  onChatIdDiscovered: (chatId: string) => void
}

const pendingGroupBuffer = new Map<string, PendingGroupChat>()

export type HandleLarkMessageFn = (opts: {
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
}) => Promise<void>

/** Handle message fn reference — set via setHandleLarkMessage */
let handleLarkMessageFn: HandleLarkMessageFn | null = null

export function setHandleLarkMessage(fn: HandleLarkMessageFn): void {
  handleLarkMessageFn = fn
}

export function addToGroupBuffer(
  chatId: string,
  text: string,
  adapter: MessengerAdapter,
  botName: string | null,
  onChatIdDiscovered: (chatId: string) => void,
  images?: string[],
  files?: string[],
  senderOpenId?: string,
  messageId?: string
): void {
  const msg: BufferedGroupMessage = { text, images, files, senderOpenId, messageId }

  const existing = pendingGroupBuffer.get(chatId)
  if (existing) {
    clearTimeout(existing.timer)
    existing.messages.push(msg)
    existing.adapter = adapter
    existing.botName = botName
    existing.onChatIdDiscovered = onChatIdDiscovered

    if (existing.messages.length >= GROUP_BUFFER_MAX_MESSAGES) {
      flushGroupBuffer(chatId).catch(error => {
        logger.error(`Failed to flush group buffer on max: ${getErrorMessage(error)}`)
      })
      return
    }

    existing.timer = setTimeout(() => {
      flushGroupBuffer(chatId).catch(error => {
        logger.error(`Failed to flush group buffer on timeout: ${getErrorMessage(error)}`)
      })
    }, GROUP_BUFFER_DELAY_MS)
  } else {
    const entry: PendingGroupChat = {
      messages: [msg],
      timer: setTimeout(() => {
        flushGroupBuffer(chatId).catch(error => {
          logger.error(`Failed to flush group buffer on timeout: ${getErrorMessage(error)}`)
        })
      }, GROUP_BUFFER_DELAY_MS),
      adapter,
      botName,
      onChatIdDiscovered,
    }
    pendingGroupBuffer.set(chatId, entry)
  }
}

async function flushGroupBuffer(chatId: string): Promise<void> {
  const pending = pendingGroupBuffer.get(chatId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingGroupBuffer.delete(chatId)

  if (!handleLarkMessageFn) {
    logger.error('handleLarkMessage not registered — call setHandleLarkMessage first')
    return
  }

  const { messages, adapter, botName, onChatIdDiscovered } = pending
  if (messages.length === 0) return

  const last = messages[messages.length - 1]!
  const allImages = messages.flatMap(m => m.images ?? [])
  const allFiles = messages.flatMap(m => m.files ?? [])

  let combinedText: string
  if (messages.length === 1) {
    combinedText = last.text
  } else {
    const formatSender = (openId?: string) =>
      openId ? `用户(${openId.slice(-4)})` : '用户'
    const contextLines = messages.slice(0, -1).map(m => {
      const attachments = [
        ...(m.images?.length ? [`+${m.images.length}图片`] : []),
        ...(m.files?.length ? [`+${m.files.length}文件`] : []),
      ].join(' ')
      return `${formatSender(m.senderOpenId)}: ${m.text || '[附件]'}${attachments ? ` ${attachments}` : ''}`
    })
    const lastAttachments = [
      ...(last.images?.length ? [`+${last.images.length}图片`] : []),
      ...(last.files?.length ? [`+${last.files.length}文件`] : []),
    ].join(' ')
    combinedText = [
      `[群聊上下文 - 最近${messages.length}条@消息]`,
      ...contextLines,
      '---',
      `最新消息（来自${formatSender(last.senderOpenId)}）: ${last.text || '[附件]'}${lastAttachments ? ` ${lastAttachments}` : ''}`,
    ].join('\n')
    logger.info(`Group buffer flushed: ${messages.length} messages for chat ${chatId.slice(0, 8)}`)
  }

  try {
    await handleLarkMessageFn({
      chatId, text: combinedText, isGroup: true, hasMention: true,
      adapter, botName, onChatIdDiscovered,
      images: allImages.length > 0 ? allImages : undefined,
      originalMessageId: last.messageId,
      files: allFiles.length > 0 ? allFiles : undefined,
      senderOpenId: last.senderOpenId,
    })
  } finally {
    // Clean up downloaded tmp files after consumption
    for (const f of [...allImages, ...allFiles]) {
      try { unlinkSync(f) } catch { /* already removed */ }
    }
  }
}

export async function destroyGroupBuffer(): Promise<void> {
  const chatIds = [...pendingGroupBuffer.keys()]
  await Promise.allSettled(chatIds.map(chatId => flushGroupBuffer(chatId)))
}
