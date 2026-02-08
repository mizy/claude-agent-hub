/**
 * 飞书/Lark 通知模块
 * 发送卡片消息通知用户审批
 *
 * 发送策略：优先使用 Lark API client（需 WSClient 已启动），
 * 否则用配置创建临时 client 发送（支持子进程场景）
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import { createLogger } from '../shared/logger.js'
import { loadConfig } from '../config/loadConfig.js'
import { getLarkClient, getDefaultLarkChatId } from './larkWsClient.js'
import { buildApprovalCard, buildCard, mdElement } from './buildLarkCard.js'
import type { LarkCard } from './buildLarkCard.js'

const logger = createLogger('lark-notify')

/**
 * Get a usable Lark client: prefer the shared WSClient instance,
 * fall back to creating a standalone client from config (for subprocess use).
 */
async function getOrCreateLarkClient(): Promise<Lark.Client | null> {
  const shared = getLarkClient()
  if (shared) return shared

  const config = await loadConfig()
  const { appId, appSecret } = config.notify?.lark || {}
  if (!appId || !appSecret) return null

  logger.debug('Creating standalone Lark client for notification')
  return new Lark.Client({ appId, appSecret })
}

export interface ReviewNotificationOptions {
  webhookUrl: string
  taskTitle: string
  workflowName: string
  workflowId: string
  instanceId: string
  nodeId: string
  nodeName: string
  chatId?: string
}

/**
 * Send approval notification to Lark with interactive buttons.
 * Strategy: try API client first (buttons work), fall back to webhook (buttons won't trigger callbacks).
 */
export async function sendReviewNotification(options: ReviewNotificationOptions): Promise<boolean> {
  const { webhookUrl, taskTitle, workflowName, workflowId, instanceId, nodeId, nodeName } = options

  const card = buildApprovalCard({ taskTitle, workflowName, workflowId, instanceId, nodeId, nodeName })

  // Try API first — buttons only work when sent via API
  const chatId = options.chatId || getDefaultLarkChatId()
  if (chatId) {
    const ok = await sendLarkCardViaApi(chatId, card)
    if (ok) {
      logger.info(`Sent review notification for node ${nodeId} via API`)
      return true
    }
    logger.warn('API card send failed, falling back to webhook')
  }

  // Webhook fallback — card renders but button callbacks won't work
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'interactive', card }),
    })

    if (!response.ok) {
      const text = await response.text()
      logger.error(`Failed to send Lark notification: ${response.status} ${text}`)
      return false
    }

    const result = (await response.json()) as { code?: number; msg?: string }
    if (result.code !== 0) {
      logger.error(`Lark webhook error: ${result.msg}`)
      return false
    }

    logger.info(`Sent review notification for node ${nodeId} via webhook`)
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to send Lark notification: ${errorMessage}`)
    return false
  }
}

/**
 * 通过 Lark API client 发送消息到指定 chat
 */
export async function sendLarkMessageViaApi(chatId: string, text: string): Promise<boolean> {
  const client = await getOrCreateLarkClient()
  if (!client) {
    logger.warn('No Lark credentials available, cannot send message')
    return false
  }

  try {
    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        content: JSON.stringify({ text }),
        msg_type: 'text',
      },
    })
    logger.info(`Sent message via Lark API to chat ${chatId}`)
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to send Lark message via API: ${errorMessage}`)
    return false
  }
}

/**
 * 发送简单文本消息
 *
 * 策略：优先通过 API client 发送（如果已初始化且提供了 chatId），
 * 否则降级到 webhook 推送
 */
export async function sendLarkMessage(
  webhookUrl: string,
  text: string,
  chatId?: string
): Promise<boolean> {
  // 优先使用 API client
  if (chatId && getLarkClient()) {
    const ok = await sendLarkMessageViaApi(chatId, text)
    if (ok) return true
    logger.warn('API send failed, falling back to webhook')
  }

  // 降级到 webhook
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text },
      }),
    })

    if (!response.ok) {
      logger.error(`Failed to send Lark message: ${response.status}`)
      return false
    }

    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to send Lark message: ${errorMessage}`)
    return false
  }
}

/**
 * 发送审批结果通知
 */
export async function sendApprovalResultNotification(
  webhookUrl: string,
  options: {
    nodeId: string
    nodeName: string
    approved: boolean
    reason?: string
  }
): Promise<boolean> {
  const { nodeId, nodeName, approved, reason } = options
  const status = approved ? '✅ 已通过' : '❌ 已拒绝'
  const reasonText = reason ? `\n**原因**: ${reason}` : ''

  const card = buildCard(
    `审批结果: ${nodeName}`,
    approved ? 'green' : 'red',
    [mdElement(`**状态**: ${status}${reasonText}\n**节点**: ${nodeId}`)]
  )

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'interactive', card }),
    })

    return response.ok
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn(`Failed to send approval result notification: ${errorMessage}`)
    return false
  }
}

/**
 * Send an interactive card via Lark API client
 */
export async function sendLarkCardViaApi(chatId: string, card: LarkCard): Promise<boolean> {
  const client = await getOrCreateLarkClient()
  if (!client) {
    logger.warn('No Lark credentials available, cannot send card')
    return false
  }

  try {
    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        content: JSON.stringify(card),
        msg_type: 'interactive',
      },
    })
    logger.info(`Sent card via Lark API to chat ${chatId}`)
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to send Lark card via API: ${errorMessage}`)
    return false
  }
}

/**
 * Update an existing card message
 */
/**
 * Upload an image to Lark and return the image_key
 */
export async function uploadLarkImage(client: Lark.Client, imageData: Buffer): Promise<string | null> {
  try {
    const res = await client.im.v1.image.create({
      data: {
        image_type: 'message',
        image: imageData,
      },
    })
    const imageKey = (res as { data?: { image_key?: string } })?.data?.image_key
    if (!imageKey) {
      logger.error('Lark image upload returned no image_key')
      return null
    }
    logger.info(`Uploaded image to Lark: ${imageKey}`)
    return imageKey
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to upload image to Lark: ${msg}`)
    return null
  }
}

/**
 * Send an image message to a Lark chat
 */
export async function sendLarkImage(client: Lark.Client, chatId: string, imageKey: string): Promise<boolean> {
  try {
    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'image',
        content: JSON.stringify({ image_key: imageKey }),
      },
    })
    logger.info(`Sent image to Lark chat ${chatId}`)
    return true
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to send image to Lark: ${msg}`)
    return false
  }
}

export async function updateLarkCard(messageId: string, card: LarkCard): Promise<boolean> {
  const client = await getOrCreateLarkClient()
  if (!client) {
    logger.warn('No Lark credentials available, cannot update card')
    return false
  }

  try {
    await client.im.v1.message.patch({
      path: { message_id: messageId },
      data: { content: JSON.stringify(card) },
    })
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to update Lark card: ${errorMessage}`)
    return false
  }
}
