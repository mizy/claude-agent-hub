/**
 * 飞书 WebSocket 长连接客户端
 *
 * 薄适配层：飞书 WSClient 事件接收 + 消息路由
 * 业务逻辑委托给 handlers/ 下的平台无关处理器
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import { createLogger } from '../shared/logger.js'
import { loadConfig } from '../config/loadConfig.js'
import { sendApprovalResultNotification } from './sendLarkNotify.js'
import { parseApprovalCommand, handleApproval } from './handlers/approvalHandler.js'
import { handleCommand } from './handlers/commandHandler.js'
import { handleChat, clearChatSession, getChatSessionInfo } from './handlers/chatHandler.js'
import type { MessengerAdapter, ParsedApproval, ClientContext } from './handlers/types.js'

const logger = createLogger('lark-ws')

let wsClient: Lark.WSClient | null = null
let larkClient: Lark.Client | null = null

// ── MessengerAdapter ──

function createAdapter(): MessengerAdapter {
  return {
    async reply(chatId, text) {
      if (!larkClient) return
      try {
        await larkClient.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            content: JSON.stringify({ text }),
            msg_type: 'text',
          },
        })
      } catch (error) {
        logger.error('Failed to reply message:', error)
      }
    },
    async sendAndGetId(chatId, text) {
      if (!larkClient) return null
      try {
        const res = await larkClient.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            content: JSON.stringify({ text }),
            msg_type: 'text',
          },
        })
        return (res as any)?.data?.message_id ?? null
      } catch (error) {
        logger.error('Failed to send message:', error)
        return null
      }
    },
    async editMessage(_chatId, messageId, text) {
      if (!larkClient || !messageId) return
      try {
        await larkClient.im.v1.message.patch({
          path: { message_id: messageId },
          data: {
            content: JSON.stringify({ text }),
          },
        })
      } catch (error) {
        logger.error('Failed to edit message:', error)
      }
    },
  }
}

// ── Message routing ──

function parseCommandText(text: string): { cmd: string; args: string } | null {
  const clean = text.replace(/@[\w\u4e00-\u9fa5]+/g, '').trim()
  if (!clean.startsWith('/')) return null
  const spaceIdx = clean.indexOf(' ')
  if (spaceIdx === -1) return { cmd: clean.toLowerCase(), args: '' }
  return { cmd: clean.slice(0, spaceIdx).toLowerCase(), args: clean.slice(spaceIdx + 1).trim() }
}

function larkClientContext(isGroup: boolean): ClientContext {
  return {
    platform: '飞书 (Lark)',
    maxMessageLength: 10000,
    supportedFormats: ['plaintext', 'code block'],
    isGroup,
  }
}

const APPROVAL_COMMANDS = new Set(['/approve', '/通过', '/批准', '/reject', '/拒绝', '/否决'])
const TASK_COMMANDS = new Set(['/run', '/list', '/logs', '/stop', '/resume', '/get', '/help', '/status'])

async function handleApprovalAndReply(approval: ParsedApproval, chatId: string, messenger: MessengerAdapter): Promise<void> {
  const result = await handleApproval(approval, async (approvalResult) => {
    const cfg = await loadConfig()
    const webhookUrl = cfg.notify?.lark?.webhookUrl
    if (webhookUrl) {
      await sendApprovalResultNotification(webhookUrl, approvalResult)
    }
  })
  logger.info(`Approval result: ${result}`)
  await messenger.reply(chatId, result)
}

async function handleLarkMessage(chatId: string, text: string, isGroup: boolean, hasMention: boolean): Promise<void> {
  const messenger = createAdapter()

  // 群聊中没 @机器人的消息，忽略
  if (isGroup && !hasMention) return

  logger.info(`Received message: ${text}`)

  // 清除 @mention 后的文本
  const cleanText = text.replace(/@[\w\u4e00-\u9fa5]+/g, '').trim()

  // 斜杠命令路由
  const parsed = parseCommandText(text)
  if (parsed) {
    // 对话会话命令
    if (parsed.cmd === '/new') {
      const cleared = clearChatSession(chatId)
      await messenger.reply(chatId, cleared ? '✅ 已开始新对话' : '当前没有活跃会话')
      return
    }
    if (parsed.cmd === '/chat') {
      const info = getChatSessionInfo(chatId)
      if (!info) {
        await messenger.reply(chatId, '当前没有活跃会话，直接发送文字即可开始对话')
      } else {
        const elapsed = Math.round((Date.now() - info.lastActiveAt) / 1000 / 60)
        await messenger.reply(chatId, `💬 会话 ${info.sessionId.slice(0, 12)}... | 活跃于 ${elapsed} 分钟前`)
      }
      return
    }

    // 审批斜杠命令 → approvalHandler
    if (APPROVAL_COMMANDS.has(parsed.cmd)) {
      const approval = parseApprovalCommand(cleanText)
      if (approval) {
        await handleApprovalAndReply(approval, chatId, messenger)
        return
      }
    }

    // 任务管理命令 → commandHandler
    if (TASK_COMMANDS.has(parsed.cmd)) {
      const cmdResult = await handleCommand(parsed.cmd, parsed.args)
      await messenger.reply(chatId, cmdResult.text)
      return
    }
  }

  // 非命令文本 → 先尝试审批裸关键字（通过、approve、ok 等），再走对话
  const approval = parseApprovalCommand(cleanText)
  if (approval) {
    await handleApprovalAndReply(approval, chatId, messenger)
    return
  }

  // 自由对话
  await handleChat(chatId, cleanText, messenger, { client: larkClientContext(isGroup) })
}

// ── Public API ──

export async function startLarkWsClient(): Promise<void> {
  if (wsClient) {
    logger.warn('Lark WebSocket client already running')
    return
  }

  const config = await loadConfig()
  const { appId, appSecret } = config.notify?.lark || {}

  if (!appId || !appSecret) {
    throw new Error('Missing Lark appId or appSecret in config')
  }

  const baseConfig = { appId, appSecret }
  larkClient = new Lark.Client(baseConfig)

  wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
  })

  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        const message = data.message
        if (!message) return
        if (message.message_type !== 'text') return

        let content: { text?: string }
        try {
          content = JSON.parse(message.content || '{}')
        } catch {
          return
        }

        const text = content.text || ''
        const chatId = message.chat_id || ''
        const hasMention = !!(message.mentions && message.mentions.length > 0)
        const isGroup = message.chat_type === 'group'

        await handleLarkMessage(chatId, text, isGroup, hasMention)
      },
    }),
  })

  logger.info('Lark WebSocket client started')
}

export async function stopLarkWsClient(): Promise<void> {
  if (!wsClient) return
  wsClient.close()
  wsClient = null
  larkClient = null
  logger.info('Lark WebSocket client stopped')
}

export function getLarkClient(): Lark.Client | null {
  return larkClient
}

export function isLarkWsClientRunning(): boolean {
  return wsClient !== null
}
