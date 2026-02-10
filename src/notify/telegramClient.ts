/**
 * Telegram Bot 长轮询客户端
 *
 * 薄适配层：Telegram Bot API 调用 + MessengerAdapter 构建
 * 消息路由委托给 handlers/messageRouter，业务逻辑在 handlers/ 下
 */

import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'
import { loadConfig } from '../config/loadConfig.js'
import { sendTelegramApprovalResult } from './sendTelegramNotify.js'
import { routeMessage } from './handlers/messageRouter.js'
import type { MessengerAdapter, ClientContext } from './handlers/types.js'

const logger = createLogger('telegram')

const TELEGRAM_API = 'https://api.telegram.org/bot'
const POLL_TIMEOUT = 30

let running = false
let botToken: string | null = null
let defaultChatId: string | null = null
let botName: string | null = null
let offset = 0

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number }
    text?: string
  }
}

// ── Telegram Bot API ──

async function callApi<T>(method: string, params?: Record<string, unknown>): Promise<T | null> {
  if (!botToken) return null
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params ?? {}),
    })
    const result = (await response.json()) as { ok: boolean; result: T; description?: string }
    if (!result.ok) {
      logger.error(`→ API ${method}: ${result.description}`)
      return null
    }
    return result.result
  } catch (error) {
    const msg = formatErrorMessage(error)
    logger.error(`→ API ${method}: ${msg}`)
    return null
  }
}

// ── MessengerAdapter（number ↔ string 转换） ──

function createAdapter(): MessengerAdapter {
  return {
    async reply(chatId, text, options) {
      await callApi('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: options?.parseMode === 'markdown' ? 'MarkdownV2' : undefined,
      })
    },
    async sendAndGetId(chatId, text) {
      const r = await callApi<{ message_id: number }>('sendMessage', {
        chat_id: chatId,
        text,
      })
      return r?.message_id != null ? String(r.message_id) : null
    },
    async editMessage(chatId, messageId, text) {
      // "message is not modified" is normal Telegram behavior (stream update unchanged), silently ignore
      await callApi('editMessageText', {
        chat_id: chatId,
        message_id: Number(messageId),
        text,
      })
    },
  }
}

// ── Client context ──

function getTelegramClientContext(): ClientContext {
  return {
    platform: 'Telegram',
    maxMessageLength: 4096,
    supportedFormats: ['plaintext', 'code block'],
    isGroup: false,
    botName: botName ?? undefined,
  }
}

// ── Telegram approval notification callback ──

async function createApprovalCallback() {
  const config = await loadConfig()
  const tgChatId = config.notify?.telegram?.chatId
  if (!tgChatId) return undefined
  return async (result: {
    nodeId: string
    nodeName: string
    approved: boolean
    reason?: string
  }) => {
    await sendTelegramApprovalResult(tgChatId, result)
  }
}

// ── Message handling (delegates to router) ──

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message
  if (!message?.text) return

  const text = message.text
  const chatIdStr = String(message.chat.id)

  const preview = text.length > 60 ? text.slice(0, 57) + '...' : text
  logger.info(`← ${preview}`)

  await routeMessage({
    chatId: chatIdStr,
    text,
    messenger: createAdapter(),
    clientContext: getTelegramClientContext(),
    onApprovalResult: await createApprovalCallback(),
    checkBareApproval: false,
  })
}

// ── Long polling ──

async function pollLoop(): Promise<void> {
  while (running) {
    try {
      const updates = await callApi<TelegramUpdate[]>('getUpdates', {
        offset,
        timeout: POLL_TIMEOUT,
      })

      if (!updates || updates.length === 0) continue

      for (const update of updates) {
        offset = update.update_id + 1
        await handleUpdate(update)
      }
    } catch (error) {
      const msg = formatErrorMessage(error)
      logger.error(`poll error: ${msg}`)
      if (running) {
        await new Promise(r => setTimeout(r, 5000))
      }
    }
  }
}

// ── Public API ──

export async function startTelegramClient(): Promise<void> {
  if (running) {
    logger.warn('Telegram client already running')
    return
  }

  const config = await loadConfig()
  const tgConfig = config.notify?.telegram

  if (!tgConfig?.botToken) {
    throw new Error('Missing Telegram botToken in config')
  }

  botToken = tgConfig.botToken
  defaultChatId = tgConfig.chatId ?? null
  offset = 0
  running = true

  const me = await callApi<{ first_name: string; username?: string }>('getMe')
  botName = me?.first_name ?? me?.username ?? null

  pollLoop().catch(err => {
    logger.error(`poll loop crashed: ${formatErrorMessage(err)}`)
    running = false
  })

  logger.info(`Telegram client started${botName ? ` as "${botName}"` : ''}`)
}

export function stopTelegramClient(): void {
  if (!running) return
  running = false
  botToken = null
  defaultChatId = null
  botName = null
  logger.info('Telegram client stopped')
}

export function isTelegramClientRunning(): boolean {
  return running
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode?: string
): Promise<boolean> {
  if (!botToken) {
    logger.warn('Telegram client not started, cannot send message')
    return false
  }

  const result = await callApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
  })
  return result !== null
}

export function getDefaultChatId(): string | null {
  return defaultChatId
}
