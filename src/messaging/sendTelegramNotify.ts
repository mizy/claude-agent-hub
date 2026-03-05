/**
 * Telegram 通知模块
 * 发送 Markdown 格式消息通知用户审批
 *
 * 发送策略：通过 Telegram Bot API 直接发送（需 client 已启动），
 * 或使用独立 fetch 调用（仅需 botToken + chatId）
 */

import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { getNotifyConfig } from '../config/index.js'
import {
  sendTelegramMessage as sendViaBotClient,
  isTelegramClientRunning,
} from './telegramClient.js'

const logger = createLogger('telegram-notify')

const TELEGRAM_API = 'https://api.telegram.org/bot'

export interface TelegramReviewNotificationOptions {
  taskTitle: string
  workflowName: string
  workflowId: string
  instanceId: string
  nodeId: string
  nodeName: string
  chatId?: string // 可选，不传则使用配置中的 chatId
}

/**
 * 直接通过 API 发送消息（不依赖 client 是否启动）
 */
async function sendDirectMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode?: string
): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    })

    const result = (await response.json()) as { ok: boolean; description?: string }
    if (!result.ok) {
      logger.error(`Telegram send failed: ${result.description}`)
      return false
    }
    return true
  } catch (error) {
    const msg = getErrorMessage(error)
    logger.error(`Telegram send error: ${msg}`)
    return false
  }
}

/**
 * 获取 Telegram 配置
 */
async function getTelegramConfig(): Promise<{ botToken: string; chatId: string } | null> {
  const notifyConfig = await getNotifyConfig()
  const tg = notifyConfig?.telegram
  if (!tg?.botToken || !tg?.chatId) {
    logger.warn('Telegram config missing botToken or chatId')
    return null
  }
  return { botToken: tg.botToken, chatId: tg.chatId }
}

/**
 * 发送审批通知到 Telegram
 */
export async function sendTelegramReviewNotification(
  options: TelegramReviewNotificationOptions
): Promise<boolean> {
  const {
    taskTitle,
    workflowName,
    workflowId,
    instanceId,
    nodeId,
    nodeName,
    chatId: overrideChatId,
  } = options

  const shortInstanceId = instanceId.slice(0, 8)

  // Telegram MarkdownV2 格式
  const text = [
    '🔔 *需要审批*',
    '',
    `*任务*: ${escapeMarkdownV2(taskTitle)}`,
    `*工作流*: ${escapeMarkdownV2(workflowName)}`,
    `*节点*: ${escapeMarkdownV2(nodeName)}`,
    `*实例*: ${escapeMarkdownV2(shortInstanceId)}`,
    '',
    '通过 CLI 命令审批:',
    `\`cah workflow approve ${workflowId.slice(0, 8)} ${nodeId}\``,
    '',
    '或回复: `/approve` / `/reject [原因]`',
  ].join('\n')

  // 优先使用已启动的 client
  if (overrideChatId && isTelegramClientRunning()) {
    const ok = await sendViaBotClient(overrideChatId, text, 'MarkdownV2')
    if (ok) {
      logger.info(`Sent review notification for node ${nodeId}`)
      return true
    }
    logger.warn('Client send failed, falling back to direct API')
  }

  // 降级到直接 API 调用
  const tgConfig = await getTelegramConfig()
  if (!tgConfig) return false

  const chatId = overrideChatId || tgConfig.chatId
  const ok = await sendDirectMessage(tgConfig.botToken, chatId, text, 'MarkdownV2')
  if (ok) {
    logger.info(`Sent review notification for node ${nodeId}`)
  }
  return ok
}

/**
 * 发送简单文本消息
 *
 * 策略：优先通过已启动的 client 发送，否则降级到直接 API 调用
 */
export async function sendTelegramTextMessage(text: string, chatId?: string): Promise<boolean> {
  // 优先使用已启动的 client
  if (chatId && isTelegramClientRunning()) {
    const ok = await sendViaBotClient(chatId, text)
    if (ok) return true
    logger.warn('Client send failed, falling back to direct API')
  }

  // 降级到直接 API 调用
  const tgConfig = await getTelegramConfig()
  if (!tgConfig) return false

  const targetChatId = chatId || tgConfig.chatId
  return sendDirectMessage(tgConfig.botToken, targetChatId, text)
}

/**
 * 发送审批结果通知
 */
export async function sendTelegramApprovalResult(
  chatId: string,
  options: {
    nodeId: string
    nodeName: string
    approved: boolean
    reason?: string
  }
): Promise<boolean> {
  const { nodeId, nodeName, approved, reason } = options
  const status = approved ? '✅ 已通过' : '❌ 已拒绝'
  const reasonLine = reason ? `\n原因: ${escapeMarkdownV2(reason)}` : ''

  const text = [
    `*审批结果: ${escapeMarkdownV2(nodeName)}*`,
    '',
    `*状态*: ${status}${reasonLine}`,
    `*节点*: \`${nodeId}\``,
  ].join('\n')

  // 优先使用 client
  if (isTelegramClientRunning()) {
    const ok = await sendViaBotClient(chatId, text, 'MarkdownV2')
    if (ok) return true
  }

  // 降级
  const tgConfig = await getTelegramConfig()
  if (!tgConfig) return false
  return sendDirectMessage(tgConfig.botToken, chatId, text, 'MarkdownV2')
}

/**
 * 转义 MarkdownV2 特殊字符
 * https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}
