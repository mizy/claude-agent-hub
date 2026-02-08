/**
 * 平台适配层类型定义
 *
 * 统一 Telegram / 飞书的消息收发抽象，
 * 让 command handler、chat handler、approval handler 不感知平台差异。
 *
 * chatId 统一用 string（Telegram number → toString，飞书本身就是 string）
 * messageId 统一用 string（Telegram number → toString，飞书 message_id 是 string）
 */

import type { LarkCard } from '../buildLarkCard.js'

// ── MessengerAdapter：平台消息收发能力 ──

export interface MessengerAdapter {
  /** 发送文本消息 */
  reply(chatId: string, text: string, options?: SendOptions): Promise<void>

  /** 发送消息并返回消息 ID（用于后续编辑） */
  sendAndGetId(chatId: string, text: string, options?: SendOptions): Promise<string | null>

  /** 编辑已发送的消息 */
  editMessage(chatId: string, messageId: string, text: string, options?: SendOptions): Promise<void>

  /** Optional: send a rich card message (Lark only) */
  replyCard?(chatId: string, card: LarkCard): Promise<void>

  /** Optional: edit an existing card message in-place (Lark only) */
  editCard?(chatId: string, messageId: string, card: LarkCard): Promise<void>

  /** Optional: send an image message */
  replyImage?(chatId: string, imageData: Buffer, fileName?: string): Promise<void>
}

export interface SendOptions {
  /** 消息格式：markdown 或 html，平台适配层自行映射到各平台的格式标识 */
  parseMode?: 'markdown' | 'html'
}

// ── 审批相关类型 ──

export interface ParsedApproval {
  action: 'approve' | 'reject'
  reason?: string
  nodeId?: string
}

export interface ApprovalResult {
  nodeId: string
  nodeName: string
  approved: boolean
  reason?: string
}

// ── 对话会话 ──

export interface ChatSession {
  sessionId: string
  lastActiveAt: number
}

// ── 命令处理结果 ──

export interface CommandResult {
  text: string
  parseMode?: 'markdown' | 'html'
  /** Optional Lark card for rich display (adapter falls back to text if unsupported) */
  larkCard?: LarkCard
}

// ── 客户端环境上下文 ──

export interface ClientContext {
  /** 平台名称，如 'telegram', 'lark', 'cli' */
  platform: string
  /** 单条消息最大字符数 */
  maxMessageLength: number
  /** 支持的格式，如 ['plaintext'] 或 ['plaintext', 'markdown'] */
  supportedFormats: string[]
  /** 是否群聊 */
  isGroup?: boolean
  /** 机器人名称（从平台 API 获取） */
  botName?: string
}

// ── 平台事件（收到的消息） ──

export interface IncomingMessage {
  chatId: string
  text: string
  /** 是否 @了机器人（飞书群聊场景） */
  isMentioned?: boolean
  /** 消息来源类型 */
  chatType?: 'private' | 'group'
}
