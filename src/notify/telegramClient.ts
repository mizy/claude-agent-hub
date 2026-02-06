/**
 * Telegram Bot 长轮询客户端
 *
 * 薄适配层：Telegram Bot API 调用 + 消息路由
 * 业务逻辑委托给 handlers/ 下的平台无关处理器
 */

import { createLogger } from '../shared/logger.js'
import { loadConfig } from '../config/loadConfig.js'
import { sendTelegramApprovalResult } from './sendTelegramNotify.js'
import { parseApprovalCommand, handleApproval } from './handlers/approvalHandler.js'
import { handleCommand } from './handlers/commandHandler.js'
import { handleChat, clearChatSession, getChatSessionInfo } from './handlers/chatHandler.js'
import type { MessengerAdapter, ClientContext } from './handlers/types.js'

const logger = createLogger('telegram')

const TELEGRAM_API = 'https://api.telegram.org/bot'
const POLL_TIMEOUT = 30

let running = false
let botToken: string | null = null
let defaultChatId: string | null = null
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
    const result = await response.json() as { ok: boolean; result: T; description?: string }
    if (!result.ok) {
      logger.error(`Telegram API ${method} failed: ${result.description}`)
      return null
    }
    return result.result
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Telegram API ${method} error: ${msg}`)
    return null
  }
}

// ── MessengerAdapter（number ↔ string 转换） ──

function createAdapter(numericChatId: number): MessengerAdapter {
  return {
    async reply(_chatId, text, options) {
      await callApi('sendMessage', {
        chat_id: numericChatId,
        text,
        parse_mode: options?.parseMode === 'markdown' ? 'MarkdownV2' : undefined,
      })
    },
    async sendAndGetId(_chatId, text) {
      const r = await callApi<{ message_id: number }>('sendMessage', {
        chat_id: numericChatId,
        text,
      })
      return r?.message_id != null ? String(r.message_id) : null
    },
    async editMessage(_chatId, messageId, text) {
      // "message is not modified" 是 Telegram 正常行为（流式更新内容未变），静默忽略
      await callApi('editMessageText', {
        chat_id: numericChatId,
        message_id: Number(messageId),
        text,
      })
    },
  }
}

// ── Message routing ──

function parseCommandText(text: string): { cmd: string; args: string } {
  const clean = text.trim()
  const spaceIdx = clean.indexOf(' ')
  if (spaceIdx === -1) return { cmd: clean.toLowerCase(), args: '' }
  return { cmd: clean.slice(0, spaceIdx).toLowerCase(), args: clean.slice(spaceIdx + 1).trim() }
}

const TELEGRAM_CLIENT_CONTEXT: ClientContext = {
  platform: 'Telegram',
  maxMessageLength: 4096,
  supportedFormats: ['plaintext', 'code block'],
  isGroup: false,
}

const APPROVAL_COMMANDS = new Set(['/approve', '/通过', '/批准', '/reject', '/拒绝', '/否决'])
const TASK_COMMANDS = new Set(['/run', '/list', '/logs', '/stop', '/resume', '/get', '/help', '/status'])

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message
  if (!message?.text) return

  const text = message.text
  const chatId = message.chat.id
  const chatIdStr = String(chatId)
  const messenger = createAdapter(chatId)

  logger.info(`Received message: ${text}`)

  // 非命令 → 自由对话
  if (!text.startsWith('/')) {
    await handleChat(chatIdStr, text, messenger, {
      client: TELEGRAM_CLIENT_CONTEXT,
    })
    return
  }

  const { cmd, args } = parseCommandText(text)

  // 对话会话命令
  if (cmd === '/new') {
    const cleared = clearChatSession(chatIdStr)
    await messenger.reply(chatIdStr, cleared ? '✅ 已开始新对话' : '当前没有活跃会话')
    return
  }
  if (cmd === '/chat') {
    const info = getChatSessionInfo(chatIdStr)
    if (!info) {
      await messenger.reply(chatIdStr, '当前没有活跃会话，直接发送文字即可开始对话')
    } else {
      const elapsed = Math.round((Date.now() - info.lastActiveAt) / 1000 / 60)
      await messenger.reply(chatIdStr, [
        '💬 当前会话信息',
        `会话 ID: ${info.sessionId.slice(0, 12)}...`,
        `最后活跃: ${elapsed} 分钟前`,
        '',
        '发送 /new 可开始新对话',
      ].join('\n'))
    }
    return
  }

  // 审批命令 → handlers/approvalHandler
  if (APPROVAL_COMMANDS.has(cmd)) {
    const approval = parseApprovalCommand(text)
    if (approval) {
      const config = await loadConfig()
      const tgChatId = config.notify?.telegram?.chatId
      const result = await handleApproval(approval, tgChatId
        ? async (r) => { await sendTelegramApprovalResult(tgChatId, r) }
        : undefined,
      )
      logger.info(`Approval result: ${result}`)
      await messenger.reply(chatIdStr, result)
    }
    return
  }

  // 任务管理命令 → handlers/commandHandler
  if (TASK_COMMANDS.has(cmd)) {
    const result = await handleCommand(cmd, args)
    await messenger.reply(chatIdStr, result.text)
    return
  }

  // 未知命令 → 当作对话
  await handleChat(chatIdStr, text, messenger, { client: TELEGRAM_CLIENT_CONTEXT })
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
      const msg = error instanceof Error ? error.message : String(error)
      logger.error(`Poll error: ${msg}`)
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

  pollLoop().catch(err => {
    logger.error('Poll loop crashed:', err)
    running = false
  })

  logger.info('Telegram client started')
}

export function stopTelegramClient(): void {
  if (!running) return
  running = false
  botToken = null
  defaultChatId = null
  logger.info('Telegram client stopped')
}

export function isTelegramClientRunning(): boolean {
  return running
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode?: string,
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
