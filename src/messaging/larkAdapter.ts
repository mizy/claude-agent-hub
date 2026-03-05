/**
 * Lark MessengerAdapter factory
 *
 * Wraps Lark SDK client into the unified MessengerAdapter interface
 * with retry support for transient API failures.
 */

import { access, readFile, stat, constants } from 'node:fs/promises'
import { basename } from 'node:path'
import type * as Lark from '@larksuiteoapi/node-sdk'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { withLarkRetry } from './larkRetry.js'
import { uploadLarkImage, sendLarkImage, uploadLarkFile, sendLarkFile, LARK_MAX_FILE_SIZE } from './sendLarkNotify.js'
import { markdownToPostContent } from './larkCardWrapper.js'
import type { LarkCard } from './buildLarkCard.js'
import type { MessengerAdapter, SendOptions, MentionTarget } from './handlers/types.js'

const logger = createLogger('lark-adapter')

interface LarkSdkResponse {
  code?: number
  data?: { message_id?: string }
}

/** Escape chars that could break Lark XML-like at tags (double-quote attrs only, single quotes not used) */
function escapeAttr(s: string): string {
  return s.replace(/[<>"&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' })[c]!)
}

/** Build @mention prefix for Lark post md tag. 'all' → @所有人 */
function buildMentionPrefix(mentions?: MentionTarget[]): string {
  if (!mentions?.length) return ''
  return mentions.map(m =>
    m.userId === 'all'
      ? '<at user_id="all">所有人</at>'
      : `<at user_id="${escapeAttr(m.userId)}">${escapeAttr(m.name)}</at>`
  ).join(' ') + ' '
}

export function createLarkAdapter(larkClient: Lark.Client): MessengerAdapter {
  /** Send a post message (create or reply), return raw SDK response */
  const sendPost = (chatId: string, text: string, replyTo?: string, label = 'send', mentions?: MentionTarget[]) => {
    const prefix = buildMentionPrefix(mentions)
    const content = markdownToPostContent(prefix + text)
    return withLarkRetry(
      () =>
        replyTo
          ? larkClient.im.v1.message.reply({
              path: { message_id: replyTo },
              data: { content, msg_type: 'post' },
            })
          : larkClient.im.v1.message.create({
              params: { receive_id_type: 'chat_id' },
              data: { receive_id: chatId, content, msg_type: 'post' },
            }),
      label
    )
  }

  return {
    async reply(chatId, text, options?: SendOptions) {
      try {
        await sendPost(chatId, text, options?.replyToMessageId, 'reply', options?.mentions)
      } catch (error) {
        logger.error(`→ reply failed: ${getErrorMessage(error)}`)
      }
    },
    async sendAndGetId(chatId, text, options?: SendOptions) {
      try {
        const res = await sendPost(chatId, text, options?.replyToMessageId, 'sendAndGetId', options?.mentions)
        return (res as LarkSdkResponse)?.data?.message_id ?? null
      } catch (error) {
        logger.error(`→ send failed: ${getErrorMessage(error)}`)
        return null
      }
    },
    async editMessage(chatId, messageId, text) {
      if (!messageId) return
      try {
        await withLarkRetry(
          () =>
            larkClient.im.v1.message.update({
              path: { message_id: messageId },
              data: {
                msg_type: 'post',
                content: markdownToPostContent(text),
              },
            }),
          'editMessage'
        )
      } catch (error) {
        // Never fall back to reply() here: streaming edits fail silently,
        // sendFinalResponse will send the complete response when done.
        logger.debug(`→ edit failed (${messageId}): ${getErrorMessage(error)}`)
      }
    },
    async replyCard(chatId: string, card: LarkCard) {
      try {
        await withLarkRetry(
          () =>
            larkClient.im.v1.message.create({
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
        logger.error(`→ card send failed: ${getErrorMessage(error)}`)
      }
    },
    async editCard(chatId: string, messageId: string, card: LarkCard) {
      if (!messageId) return
      try {
        logger.debug(`→ editCard called for msgId=${messageId}`)
        const res = await withLarkRetry(
          () =>
            larkClient.im.v1.message.patch({
              path: { message_id: messageId },
              data: { content: JSON.stringify(card) },
            }),
          'editCard'
        )
        logger.debug(`→ editCard response: code=${(res as LarkSdkResponse)?.code}`)
      } catch (error) {
        const msg = getErrorMessage(error)
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
    async replyFile(chatId: string, fileData: Buffer, fileName: string) {
      try {
        if (fileData.length > LARK_MAX_FILE_SIZE) {
          logger.error(`File too large for Lark upload: ${fileData.length} bytes (max 30MB)`)
          return
        }
        const fileKey = await uploadLarkFile(larkClient, fileData, fileName)
        if (!fileKey) return
        await sendLarkFile(larkClient, chatId, fileKey, fileName)
      } catch (error) {
        logger.error(`→ replyFile failed: ${getErrorMessage(error)}`)
      }
    },
    async sendFile(chatId: string, filePath: string) {
      try {
        await access(filePath, constants.R_OK)
        const stats = await stat(filePath)
        if (stats.size > LARK_MAX_FILE_SIZE) {
          logger.error(`File too large for Lark upload: ${stats.size} bytes (max 30MB)`)
          return
        }
        const fileData = await readFile(filePath)
        const fileName = basename(filePath)
        const fileKey = await uploadLarkFile(larkClient, fileData, fileName)
        if (!fileKey) return
        await sendLarkFile(larkClient, chatId, fileKey, fileName)
      } catch (error) {
        logger.error(`→ sendFile failed: ${getErrorMessage(error)}`)
      }
    },
    async sendImage(chatId: string, imagePath: string) {
      try {
        const imageData = await readFile(imagePath)
        const imageKey = await uploadLarkImage(larkClient, imageData)
        if (!imageKey) return
        await sendLarkImage(larkClient, chatId, imageKey)
      } catch (error) {
        logger.error(`→ sendImage failed: ${getErrorMessage(error)}`)
      }
    },
  }
}
