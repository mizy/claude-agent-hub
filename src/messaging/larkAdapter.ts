/**
 * Lark MessengerAdapter factory
 *
 * Wraps Lark SDK client into the unified MessengerAdapter interface
 * with retry support for transient API failures.
 */

import type * as Lark from '@larksuiteoapi/node-sdk'
import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'
import { uploadLarkImage, sendLarkImage } from './sendLarkNotify.js'
import { buildMarkdownCard } from './larkCardWrapper.js'
import type { LarkCard } from './buildLarkCard.js'
import type { MessengerAdapter } from './handlers/types.js'

const logger = createLogger('lark-adapter')

interface LarkSdkResponse {
  code?: number
  data?: { message_id?: string }
}

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

export function createLarkAdapter(larkClient: Lark.Client): MessengerAdapter {
  return {
    async reply(chatId, text) {
      try {
        await withRetry(
          () =>
            larkClient.im.v1.message.create({
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
          () =>
            larkClient.im.v1.message.create({
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
          () =>
            larkClient.im.v1.message.patch({
              path: { message_id: messageId },
              data: { content: buildMarkdownCard(text) },
            }),
          'editMessage'
        )
      } catch (error) {
        const msg = formatErrorMessage(error)
        if (msg.includes('NOT a card') || msg.includes('not a card')) {
          logger.warn(`→ edit failed (not a card), falling back to reply: ${messageId}`)
          await this.reply(chatId, text)
        } else if (msg.includes('400')) {
          logger.debug(`→ edit skipped (400): ${messageId}`)
        } else {
          logger.error(`→ edit failed: ${msg}`)
        }
      }
    },
    async replyCard(chatId: string, card: LarkCard) {
      try {
        await withRetry(
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
        logger.error(`→ card send failed: ${formatErrorMessage(error)}`)
      }
    },
    async editCard(chatId: string, messageId: string, card: LarkCard) {
      if (!messageId) return
      try {
        logger.debug(`→ editCard called for msgId=${messageId}`)
        const res = await withRetry(
          () =>
            larkClient.im.v1.message.patch({
              path: { message_id: messageId },
              data: { content: JSON.stringify(card) },
            }),
          'editCard'
        )
        logger.debug(`→ editCard response: code=${(res as LarkSdkResponse)?.code}`)
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
