/**
 * IM 对话日志
 *
 * 记录完整的 IM 平台（飞书/Telegram）与 AI 的交互历史
 * 格式：JSONL，每行一条记录
 * 位置：DATA_DIR/conversation.jsonl
 */

import { join } from 'path'
import { appendFileSync, mkdirSync, readFileSync } from 'fs'
import { DATA_DIR } from '../../store/paths.js'
import { createLogger } from '../../shared/logger.js'
import { formatErrorMessage } from '../../shared/formatErrorMessage.js'

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
  /** Image file paths attached to this message */
  images?: string[]
  /** Cost in USD for this response, only dir=out */
  costUsd?: number
  /** Model used for this response, only dir=out */
  model?: string
  /** Backend type used for this response, only dir=out */
  backendType?: string
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
    logger.warn(`Failed to write conversation log: ${formatErrorMessage(error)}`)
  }
}

/**
 * Read recent conversation entries for a chatId.
 * Returns the last N entries (both in and out) in chronological order.
 */
export function getRecentConversations(chatId: string, limit = 10): ConversationEntry[] {
  try {
    const content = readFileSync(CONVERSATION_LOG_PATH, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    // Parse from the end to find matching entries efficiently
    const matched: ConversationEntry[] = []
    for (let i = lines.length - 1; i >= 0 && matched.length < limit; i--) {
      try {
        const entry = JSON.parse(lines[i]!) as ConversationEntry
        if (entry.chatId === chatId) {
          matched.unshift(entry) // maintain chronological order
        }
      } catch {
        // skip malformed lines
      }
    }
    return matched
  } catch {
    return []
  }
}

// ── Cost aggregation ──

export interface CostStats {
  totalUsd: number
  byModel: Record<string, { count: number; costUsd: number }>
  messageCount: number
}

/**
 * Parse all conversation entries from the JSONL file.
 * Filters by optional time range and chatId.
 */
function parseEntries(opts?: { since?: Date; chatId?: string }): ConversationEntry[] {
  try {
    const content = readFileSync(CONVERSATION_LOG_PATH, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const entries: ConversationEntry[] = []
    const sinceMs = opts?.since?.getTime()

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ConversationEntry
        if (entry.dir !== 'out') continue
        if (opts?.chatId && entry.chatId !== opts.chatId) continue
        if (sinceMs && new Date(entry.ts).getTime() < sinceMs) continue
        entries.push(entry)
      } catch {
        // skip malformed
      }
    }
    return entries
  } catch {
    return []
  }
}

function aggregateCost(entries: ConversationEntry[]): CostStats {
  const byModel: Record<string, { count: number; costUsd: number }> = {}
  let totalUsd = 0
  let messageCount = 0

  for (const e of entries) {
    if (e.costUsd == null) continue
    messageCount++
    totalUsd += e.costUsd
    const model = e.model || 'unknown'
    if (!byModel[model]) byModel[model] = { count: 0, costUsd: 0 }
    byModel[model]!.count++
    byModel[model]!.costUsd += e.costUsd
  }

  return { totalUsd, byModel, messageCount }
}

/** Get cost stats for a specific chatId (all time) */
export function getChatCost(chatId: string): CostStats {
  return aggregateCost(parseEntries({ chatId }))
}

/** Get cost stats since a given date */
export function getCostSince(since: Date): CostStats {
  return aggregateCost(parseEntries({ since }))
}

/** Get today's cost stats */
export function getDailyCost(): CostStats {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return getCostSince(today)
}

/** Get this week's cost stats (Monday start) */
export function getWeeklyCost(): CostStats {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? 6 : day - 1 // Monday = 0
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  monday.setHours(0, 0, 0, 0)
  return getCostSince(monday)
}

/** Get this month's cost stats */
export function getMonthlyCost(): CostStats {
  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
  return getCostSince(firstDay)
}
