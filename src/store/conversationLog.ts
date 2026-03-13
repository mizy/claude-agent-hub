/**
 * IM 对话日志
 *
 * 记录完整的 IM 平台（飞书/Telegram）与 AI 的交互历史
 * 格式：JSONL，每行一条记录
 * 位置：DATA_DIR/conversation.jsonl
 */

import { join } from 'path'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  readSync,
  closeSync,
  statSync,
} from 'fs'
import { DATA_DIR } from './paths.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('conv-log')

const CONVERSATION_LOG_PATH = join(DATA_DIR, 'conversation.jsonl')

export interface ConversationEntry {
  /** ISO 8601 时间戳 */
  ts: string
  /** 消息方向：in=用户发送, out=AI回复, event=会话事件, cmd=CLI命令 */
  dir: 'in' | 'out' | 'event' | 'cmd'
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
  /** Event name, only dir=event */
  event?: string
  /** Event detail, only dir=event */
  eventDetail?: string
  /** Full CLI command (prompt replaced with placeholder), only dir=cmd */
  command?: string
  /** Prompt character count, only dir=cmd */
  promptLength?: number
  /** Path to full prompt file, only dir=cmd */
  promptFile?: string
  /** Working directory, only dir=cmd */
  cwd?: string
  /** Task ID, only dir=cmd */
  taskId?: string
}

/** Read the last N lines from a file by seeking from the end. */
function readTailLines(filePath: string, maxLines: number): string[] {
  const CHUNK_SIZE = 8192
  let fd: number
  let fileSize: number
  try {
    fileSize = statSync(filePath).size
    fd = openSync(filePath, 'r')
  } catch {
    return []
  }

  try {
    const lines: string[] = []
    let carryBuf = Buffer.alloc(0) // bytes carried from previous chunk (incomplete UTF-8)
    let position = fileSize

    while (position > 0 && lines.length < maxLines) {
      const readSize = Math.min(CHUNK_SIZE, position)
      position -= readSize
      const buf = Buffer.alloc(readSize)
      readSync(fd, buf, 0, readSize, position)
      // Concat raw bytes with carry to avoid splitting multi-byte chars
      const combined = carryBuf.length > 0 ? Buffer.concat([buf, carryBuf]) : buf
      const chunk = combined.toString('utf-8')
      const parts = chunk.split('\n')
      // The first part may start mid-character at the chunk boundary;
      // keep its raw bytes as carry for the next iteration
      carryBuf = Buffer.from(parts[0]!, 'utf-8')
      // parts[1..] are complete lines, add from the end
      for (let i = parts.length - 1; i >= 1 && lines.length < maxLines; i--) {
        const line = parts[i]!.trim()
        if (line) lines.unshift(line)
      }
    }
    // Handle the very first line of the file
    const remaining = carryBuf.toString('utf-8').trim()
    if (remaining && lines.length < maxLines) {
      lines.unshift(remaining)
    }
    return lines
  } finally {
    closeSync(fd)
  }
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
    logger.warn(`Failed to write conversation log: ${getErrorMessage(error)}`)
  }
}

/**
 * Read recent conversation entries for a chatId.
 * Returns the last N entries (both in and out) in chronological order.
 * Uses tail-read to avoid loading the entire file into memory.
 */
export function getRecentConversations(chatId: string, limit = 10): ConversationEntry[] {
  try {
    const lines = readTailLines(CONVERSATION_LOG_PATH, limit * 20) // read more lines to account for filtering

    const matched: ConversationEntry[] = []
    for (let i = lines.length - 1; i >= 0 && matched.length < limit; i--) {
      try {
        const entry = JSON.parse(lines[i]!) as ConversationEntry
        if (entry.chatId === chatId) {
          matched.unshift(entry)
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

// ── Event logging (replaces conversationLogger.ts) ──

/** Log a conversation-level event (e.g. new session, backend switch) */
export function logConversationEvent(event: string, details?: string, chatId?: string): void {
  logConversation({
    ts: new Date().toISOString(),
    dir: 'event',
    platform: '',
    chatId: chatId ?? '',
    text: details ? `${event} — ${details}` : event,
    event,
    eventDetail: details,
  })
}

// ── CLI command logging ──

const PROMPTS_DIR = join(DATA_DIR, 'logs', 'prompts')
let promptsDirInit = false

/** Log a CLI backend command invocation. Full prompt saved to separate file. */
export function logCliCommand(entry: {
  backend: string
  command: string
  prompt: string
  sessionId?: string
  model?: string
  cwd?: string
  taskId?: string
  chatId?: string
}): void {
  // Write full prompt to DATA_DIR/logs/prompts/{ts}-{backend}.txt
  let promptFile: string | undefined
  try {
    if (!promptsDirInit) {
      mkdirSync(PROMPTS_DIR, { recursive: true })
      promptsDirInit = true
    }
    const date = new Date().toISOString().split('T')[0]
    const ts = new Date().toISOString()
    const filename = `${date}.txt`
    promptFile = join(PROMPTS_DIR, filename)
    const separator = `\n\n========== ${ts} | ${entry.backend} | ${entry.model ?? 'unknown'} | ${entry.command ?? 'chat'} ==========\n\n`
    appendFileSync(promptFile, separator + entry.prompt, 'utf-8')
  } catch (error) {
    logger.debug(`Failed to write prompt file: ${getErrorMessage(error)}`)
  }

  logConversation({
    ts: new Date().toISOString(),
    dir: 'cmd',
    platform: '',
    chatId: entry.chatId ?? '',
    text: '',
    promptLength: entry.prompt.length,
    promptFile,
    sessionId: entry.sessionId,
    model: entry.model,
    backendType: entry.backend,
    command: entry.command,
    cwd: entry.cwd,
    taskId: entry.taskId,
  })
}

/** Build a redacted CLI command string (replace prompt with length placeholder) */
export function buildRedactedCommand(binary: string, args: string[], prompt: string): string {
  return [binary, ...args.map(a => (a === prompt ? `<prompt:${prompt.length} chars>` : a))].join(
    ' '
  )
}
