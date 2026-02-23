/**
 * Human-readable conversation logger
 *
 * Writes IM conversations in a chat-like format for easy reading.
 * Output: DATA_DIR/logs/conversation.log
 *
 * Format:
 *   [2026-02-23 12:00:01] → 用户(lark): 帮我重构 logger 模块
 *   [2026-02-23 12:00:15] ← AI (14s): 好的，我来分析当前的日志架构...
 *   [2026-02-23 12:01:02] → 用户(lark): /approve
 */

import { join } from 'path'
import { appendFileSync, mkdirSync, statSync, renameSync } from 'fs'
import { DATA_DIR } from '../store/paths.js'
import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'

const logger = createLogger('conv-logger')

const LOGS_DIR = join(DATA_DIR, 'logs')
const LOG_FILE = join(LOGS_DIR, 'conversation.log')
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_MESSAGE_LENGTH = 200

let initialized = false

function ensureDir(): void {
  if (initialized) return
  mkdirSync(LOGS_DIR, { recursive: true })
  initialized = true
}

function formatTimestamp(): string {
  const now = new Date()
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim()
  if (oneLine.length <= maxLen) return oneLine
  return oneLine.slice(0, maxLen) + '...'
}

function rotateIfNeeded(): void {
  try {
    const stat = statSync(LOG_FILE)
    if (stat.size >= MAX_FILE_SIZE) {
      const rotated = LOG_FILE + '.1'
      renameSync(LOG_FILE, rotated)
    }
  } catch {
    // file doesn't exist yet, no need to rotate
  }
}

function writeLine(line: string): void {
  try {
    ensureDir()
    rotateIfNeeded()
    appendFileSync(LOG_FILE, line + '\n', 'utf-8')
  } catch (error) {
    logger.warn(`Failed to write conversation log: ${formatErrorMessage(error)}`)
  }
}

/** Log an incoming user message */
export function logUserMessage(
  source: 'lark' | 'telegram' | string,
  userId: string,
  content: string
): void {
  const ts = formatTimestamp()
  const preview = truncate(content, MAX_MESSAGE_LENGTH)
  writeLine(`[${ts}] → 用户(${source}/${userId}): ${preview}`)
}

/** Log an outgoing AI response */
export function logAIResponse(content: string, durationMs: number): void {
  const ts = formatTimestamp()
  const dur = durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
  const preview = truncate(content, MAX_MESSAGE_LENGTH)
  writeLine(`[${ts}] ← AI (${dur}): ${preview}`)
}

/** Log a conversation-level event (e.g. new session, context switch) */
export function logConversationEvent(event: string, details?: string): void {
  const ts = formatTimestamp()
  const suffix = details ? ` — ${details}` : ''
  writeLine(`[${ts}] ◆ ${event}${suffix}`)
}
