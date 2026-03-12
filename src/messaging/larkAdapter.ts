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
  // Cache: once streaming element update fails with 300309, skip directly to card.update
  let streamingElementDisabled = false

  /** Full card update — fallback when cardElement.content is unavailable */
  async function updateCardFull(cardId: string, elementId: string, content: string, sequence: number): Promise<boolean> {
    try {
      const cardJson = JSON.stringify({
        schema: '2.0',
        config: { update_multi: true },
        body: {
          elements: [
            { tag: 'markdown', content, element_id: elementId },
          ],
        },
      })
      await withLarkRetry(
        () => larkClient.cardkit.v1.card.update({
          data: { card: { type: 'card_json', data: cardJson }, sequence },
          path: { card_id: cardId },
        }),
        'updateCardFull'
      )
      return true
    } catch (error) {
      logger.error(`→ updateCardFull failed: ${getErrorMessage(error)}`)
      return false
    }
  }

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
      if (!messageId) return false
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
        return true
      } catch (error) {
        logger.debug(`→ edit failed (${messageId}): ${getErrorMessage(error)}`)
        return false
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
    async deleteMessage(_chatId: string, messageId: string) {
      try {
        await withLarkRetry(
          () => larkClient.im.v1.message.delete({ path: { message_id: messageId } }),
          'deleteMessage'
        )
        return true
      } catch (error) {
        logger.warn(`→ deleteMessage failed (${messageId}): ${getErrorMessage(error)}`)
        return false
      }
    },
    async sendCard(chatId: string, cardJson: string, options?: SendOptions) {
      try {
        const res = await withLarkRetry(
          () =>
            options?.replyToMessageId
              ? larkClient.im.v1.message.reply({
                  path: { message_id: options.replyToMessageId! },
                  data: { content: cardJson, msg_type: 'interactive' },
                })
              : larkClient.im.v1.message.create({
                  params: { receive_id_type: 'chat_id' },
                  data: { receive_id: chatId, content: cardJson, msg_type: 'interactive' },
                }),
          'sendCard'
        )
        return (res as LarkSdkResponse)?.data?.message_id ?? null
      } catch (error) {
        logger.error(`→ sendCard failed: ${getErrorMessage(error)}`)
        return null
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

    async createStreamingCard(chatId: string, initialContent: string) {
      const elementId = 'streaming_content'
      try {
        const cardJson = JSON.stringify({
          schema: '2.0',
          config: {
            update_multi: true,
            streaming_mode: true,
            streaming_config: { print_frequency_ms: { default: 50 }, print_step: { default: 1 } },
          },
          body: {
            elements: [
              { tag: 'markdown', content: initialContent, element_id: elementId },
            ],
          },
        })
        const createRes = await withLarkRetry(
          () => larkClient.cardkit.v1.card.create({ data: { type: 'card_json', data: cardJson } }),
          'createStreamingCard'
        )
        const cardId = createRes?.data?.card_id
        if (!cardId) {
          logger.error('→ createStreamingCard: no card_id in response')
          return null
        }

        const sendRes = await withLarkRetry(
          () => larkClient.im.v1.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
              receive_id: chatId,
              content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
              msg_type: 'interactive',
            },
          }),
          'createStreamingCard:send'
        )
        const messageId = (sendRes as LarkSdkResponse)?.data?.message_id ?? null
        return { cardId, elementId, messageId }
      } catch (error) {
        logger.error(`→ createStreamingCard failed: ${getErrorMessage(error)}`)
        return null
      }
    },

    async updateCardElement(cardId: string, elementId: string, content: string, sequence: number, uuid?: string) {
      // After first 300309 error, skip element API entirely → saves one round-trip per update
      if (streamingElementDisabled) {
        return updateCardFull(cardId, elementId, content, sequence)
      }
      try {
        await withLarkRetry(
          () => larkClient.cardkit.v1.cardElement.content({
            data: { content, sequence, ...(uuid ? { uuid } : {}) },
            path: { card_id: cardId, element_id: elementId },
          }),
          'updateCardElement'
        )
        return true
      } catch (error) {
        const msg = getErrorMessage(error)
        // 300309 = streaming mode not available — cache & fallback to full card update
        if (msg.includes('300309') || msg.includes('streaming mode')) {
          streamingElementDisabled = true
          logger.warn(`→ updateCardElement: streaming mode closed, falling back to card.update (cached)`)
          return updateCardFull(cardId, elementId, content, sequence)
        }
        logger.error(`→ updateCardElement failed: ${msg}`)
        return false
      }
    },

    async closeStreamingCard(cardId: string, summary: string, sequence: number) {
      try {
        const truncated = summary.replace(/\n/g, ' ').trim().slice(0, 47) + (summary.length > 47 ? '...' : '')
        const settings = JSON.stringify({
          config: { streaming_mode: false, summary: { content: truncated } },
        })
        await withLarkRetry(
          () => larkClient.cardkit.v1.card.settings({
            data: { settings, sequence, uuid: `c_${cardId}_${sequence}` },
            path: { card_id: cardId },
          }),
          'closeStreamingCard'
        )
        return true
      } catch (error) {
        logger.debug(`→ closeStreamingCard failed: ${getErrorMessage(error)}`)
        return false
      }
    },
  }
}
