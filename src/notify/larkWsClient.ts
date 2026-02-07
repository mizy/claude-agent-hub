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
import { buildWelcomeCard } from './buildLarkCard.js'
import { parseApprovalCommand, handleApproval } from './handlers/approvalHandler.js'
import { handleCommand } from './handlers/commandHandler.js'
import { handleChat, clearChatSession, getChatSessionInfo } from './handlers/chatHandler.js'
import type { MessengerAdapter, ParsedApproval, ClientContext } from './handlers/types.js'

const logger = createLogger('lark-ws')

let wsClient: Lark.WSClient | null = null
let larkClient: Lark.Client | null = null
let larkBotName: string | null = null
let defaultLarkChatId: string | null = null

// 消息去重：防止飞书 SDK 重复投递同一条消息
const DEDUP_TTL_MS = 60_000
const recentMessageIds = new Map<string, number>()

function isDuplicateMessage(messageId: string): boolean {
  if (!messageId) return false
  if (recentMessageIds.has(messageId)) return true
  recentMessageIds.set(messageId, Date.now())
  // 清理过期条目
  if (recentMessageIds.size > 100) {
    const now = Date.now()
    for (const [id, ts] of recentMessageIds) {
      if (now - ts > DEDUP_TTL_MS) recentMessageIds.delete(id)
    }
  }
  return false
}

// ── Lark Card helpers ──

/**
 * 将标准 markdown 表格转为飞书 <table> 标签
 * 输入: | col1 | col2 |\n|---|---|\n| a | b |
 * 输出: <table columns={[...]} data={[...]}/>
 */
function convertMarkdownTables(text: string): string {
  // 匹配连续的 | 开头的行（至少 3 行：header + separator + 1 row）
  return text.replace(
    /(?:^|\n)((?:\|[^\n]+\|\n){2,}(?:\|[^\n]+\|))/g,
    (_match, tableBlock: string) => {
      const lines = tableBlock.trim().split('\n')
      if (lines.length < 3) return tableBlock

      // 解析表头
      const headerCells = lines[0]!.split('|').filter(c => c.trim()).map(c => c.trim())
      // 跳过分隔行（|---|---|）
      const isSeparator = (line: string) => /^\|[\s\-:]+\|$/.test(line.trim())
      if (!isSeparator(lines[1]!)) return tableBlock

      // 解析数据行
      const dataRows = lines.slice(2).filter(l => !isSeparator(l))
      const columns = headerCells.map(h => ({
        tag: 'plain_text' as const,
        width: 'auto' as const,
        text: h,
      }))
      const data = dataRows.map(row => {
        const cells = row.split('|').filter(c => c.trim()).map(c => c.trim())
        const obj: Record<string, string> = {}
        headerCells.forEach((h, i) => {
          obj[h] = cells[i] ?? ''
        })
        return obj
      })

      const columnsJson = JSON.stringify(columns)
      const dataJson = JSON.stringify(data)
      return `\n<table columns=${columnsJson} data=${dataJson}/>`
    }
  )
}

/** 将文本包装成飞书 markdown 卡片 */
function buildMarkdownCard(text: string): string {
  const content = convertMarkdownTables(text)
  return JSON.stringify({
    config: { wide_screen_mode: true },
    elements: [{ tag: 'markdown', content }],
  })
}

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
            content: buildMarkdownCard(text),
            msg_type: 'interactive',
          },
        })
      } catch (error) {
        logger.error(`→ reply failed: ${error instanceof Error ? error.message : error}`)
      }
    },
    async sendAndGetId(chatId, text) {
      if (!larkClient) return null
      try {
        const res = await larkClient.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            content: buildMarkdownCard(text),
            msg_type: 'interactive',
          },
        })
        return (res as any)?.data?.message_id ?? null
      } catch (error) {
        logger.error(`→ send failed: ${error instanceof Error ? error.message : error}`)
        return null
      }
    },
    async editMessage(_chatId, messageId, text) {
      if (!larkClient || !messageId) return
      try {
        // patch (PATCH) 编辑卡片消息
        await larkClient.im.v1.message.patch({
          path: { message_id: messageId },
          data: {
            content: buildMarkdownCard(text),
          },
        })
      } catch (error) {
        logger.error(`→ edit failed: ${error instanceof Error ? error.message : error}`)
      }
    },
    async replyCard(chatId, card) {
      if (!larkClient) return
      try {
        await larkClient.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            content: JSON.stringify(card),
            msg_type: 'interactive',
          },
        })
      } catch (error) {
        logger.error(`→ card send failed: ${error instanceof Error ? error.message : error}`)
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
    supportedFormats: ['markdown', 'code block'],
    isGroup,
    botName: larkBotName ?? undefined,
  }
}

const APPROVAL_COMMANDS = new Set(['/approve', '/通过', '/批准', '/reject', '/拒绝', '/否决'])
const TASK_COMMANDS = new Set([
  '/run',
  '/list',
  '/logs',
  '/stop',
  '/resume',
  '/get',
  '/help',
  '/status',
])

async function handleApprovalAndReply(
  approval: ParsedApproval,
  chatId: string,
  messenger: MessengerAdapter
): Promise<void> {
  const result = await handleApproval(approval, async approvalResult => {
    const cfg = await loadConfig()
    const webhookUrl = cfg.notify?.lark?.webhookUrl
    if (webhookUrl) {
      await sendApprovalResultNotification(webhookUrl, approvalResult)
    }
  })
  logger.info(`→ approval: ${approval.action} ${approval.nodeId ?? '(auto)'}`)
  await messenger.reply(chatId, result)
}

async function handleLarkMessage(
  chatId: string,
  text: string,
  isGroup: boolean,
  hasMention: boolean
): Promise<void> {
  const messenger = createAdapter()

  // 群聊中没 @机器人的消息，忽略
  if (isGroup && !hasMention) return

  // Auto-record default chatId from first DM for push notifications
  if (!isGroup && !defaultLarkChatId) {
    defaultLarkChatId = chatId
    logger.info(`Default Lark chatId recorded: ${chatId}`)
  }

  const preview = text.length > 60 ? text.slice(0, 57) + '...' : text
  logger.info(`← [${isGroup ? 'group' : 'dm'}] ${preview}`)

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
        await messenger.reply(
          chatId,
          `💬 会话 ${info.sessionId.slice(0, 12)}... | 活跃于 ${elapsed} 分钟前`
        )
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

    // 任务管理命令 → commandHandler (prefer card when available)
    if (TASK_COMMANDS.has(parsed.cmd)) {
      const cmdResult = await handleCommand(parsed.cmd, parsed.args)
      if (cmdResult.larkCard && messenger.replyCard) {
        await messenger.replyCard(chatId, cmdResult.larkCard)
      } else {
        await messenger.reply(chatId, cmdResult.text)
      }
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

// ── Card action + new event handlers ──

async function handleCardAction(data: any): Promise<void> {
  const chatId = data?.open_chat_id
  const value = data?.action?.value
  if (!chatId || !value) return

  const actionType = value.action
  logger.info(`← [card] action=${actionType} nodeId=${value.nodeId ?? '?'}`)

  if (actionType === 'approve' || actionType === 'reject') {
    const approval: ParsedApproval = {
      action: actionType,
      nodeId: value.nodeId,
    }
    const messenger = createAdapter()
    await handleApprovalAndReply(approval, chatId, messenger)
  } else {
    logger.warn(`Unknown card action: ${actionType}`)
  }
}

async function handleP2pChatCreate(data: any): Promise<void> {
  const chatId = data?.chat_id
  if (!chatId) return

  if (!defaultLarkChatId) {
    defaultLarkChatId = chatId
    logger.info(`Default Lark chatId recorded: ${chatId}`)
  }

  const messenger = createAdapter()
  if (messenger.replyCard) {
    await messenger.replyCard(chatId, buildWelcomeCard())
  } else {
    await messenger.reply(chatId, '欢迎使用 Claude Agent Hub! 发送 /help 查看指令')
  }
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

  // 获取机器人名称
  try {
    const res = await larkClient.request({
      method: 'GET',
      url: '/open-apis/bot/v3/info/',
    })
    larkBotName = (res as any)?.data?.bot?.app_name ?? null
  } catch {
    // 非关键，忽略
  }

  wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
  })

  const dispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data: any) => {
      const message = data.message
      if (!message) return
      if (message.message_type !== 'text') return

      // 消息去重
      const messageId = message.message_id
      if (messageId && isDuplicateMessage(messageId)) {
        logger.debug(`Duplicate message ignored: ${messageId}`)
        return
      }

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
  })

  // Card button callback
  try {
    dispatcher.register({ 'card.action.trigger': handleCardAction } as any)
  } catch {
    logger.warn('card.action.trigger registration not supported by SDK, skipping')
  }

  // New chat created (welcome message)
  try {
    dispatcher.register({ 'p2p_chat_create': handleP2pChatCreate } as any)
  } catch {
    logger.warn('p2p_chat_create registration not supported by SDK, skipping')
  }

  // Log-only events
  const logEvent = (name: string) => async (data: any) => {
    logger.info(`← [event] ${name}: ${JSON.stringify(data).slice(0, 120)}`)
  }
  try {
    dispatcher.register({
      'im.message.reaction.created_v1': logEvent('reaction.created'),
      'im.message.reaction.deleted_v1': logEvent('reaction.deleted'),
      'im.message.recalled_v1': logEvent('message.recalled'),
      'im.chat.member.user.added_v1': logEvent('chat.member.added'),
      'im.message.bot_muted_v1': logEvent('bot.muted'),
    } as any)
  } catch {
    logger.debug('Some log-only event registrations not supported, skipping')
  }

  wsClient.start({ eventDispatcher: dispatcher })

  logger.info(`Lark WebSocket client started${larkBotName ? ` as "${larkBotName}"` : ''}`)
}

export async function stopLarkWsClient(): Promise<void> {
  if (!wsClient) return
  wsClient.close()
  wsClient = null
  larkClient = null
  larkBotName = null
  defaultLarkChatId = null
  logger.info('Lark WebSocket client stopped')
}

export function getLarkClient(): Lark.Client | null {
  return larkClient
}

export function isLarkWsClientRunning(): boolean {
  return wsClient !== null
}

export function getDefaultLarkChatId(): string | null {
  return defaultLarkChatId
}
