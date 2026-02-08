/**
 * IM 对话日志
 *
 * 记录完整的 IM 平台（飞书/Telegram）与 AI 的交互历史
 * 格式：JSONL，每行一条记录
 * 位置：DATA_DIR/conversation.jsonl
 */

import { join } from 'path'
import { appendFileSync, mkdirSync } from 'fs'
import { DATA_DIR } from '../../store/paths.js'
import { createLogger } from '../../shared/logger.js'

const logger = createLogger('conv-log')

const CONVERSATION_LOG_PATH = join(DATA_DIR, 'conversation.jsonl')

export interface ConversationEntry {
  /** ISO 8601 时间戳 */
  ts: string
  /** 消息方向：in=用户发送, out=AI回复 */
  dir: 'in' | 'out'
  /** 平台 */
  platform: string
  /** 聊天 ID */
  chatId: string
  /** 会话 ID（Claude Code session） */
  sessionId?: string
  /** 消息内容 */
  text: string
  /** AI 响应耗时（毫秒），仅 dir=out 时有值 */
  durationMs?: number
}

let initialized = false

function ensureDir(): void {
  if (initialized) return
  mkdirSync(DATA_DIR, { recursive: true })
  initialized = true
}

export function logConversation(entry: ConversationEntry): void {
  try {
    ensureDir()
    appendFileSync(CONVERSATION_LOG_PATH, JSON.stringify(entry) + '\n', 'utf-8')
  } catch (error) {
    logger.warn(
      `Failed to write conversation log: ${error instanceof Error ? error.message : error}`
    )
  }
}
