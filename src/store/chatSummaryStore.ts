/**
 * Per-chatId conversation summary store
 *
 * Stores compressed conversation summaries generated at session end.
 * Loaded at new session start to provide context without raw message truncation.
 */

import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { DATA_DIR } from './paths.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('chat-summary-store')

const SUMMARIES_DIR = join(DATA_DIR, 'chat-summaries')

export interface ChatSummary {
  chatId: string
  summary: string
  updatedAt: string
}

let dirEnsured = false
function ensureDir(): void {
  if (dirEnsured) return
  mkdirSync(SUMMARIES_DIR, { recursive: true })
  dirEnsured = true
}

function filePath(chatId: string): string {
  // Sanitize chatId for filesystem
  const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(SUMMARIES_DIR, `${safe}.json`)
}

export function saveChatSummary(chatId: string, summary: string): void {
  try {
    ensureDir()
    const data: ChatSummary = { chatId, summary, updatedAt: new Date().toISOString() }
    writeFileSync(filePath(chatId), JSON.stringify(data, null, 2), 'utf-8')
    logger.debug(`Saved chat summary for ${chatId.slice(0, 8)} (${summary.length} chars)`)
  } catch (e) {
    logger.warn(`Failed to save chat summary: ${getErrorMessage(e)}`)
  }
}

export function loadChatSummary(chatId: string): { summary: string; updatedAt: string } | null {
  try {
    const raw = readFileSync(filePath(chatId), 'utf-8')
    const data = JSON.parse(raw) as ChatSummary
    if (!data.summary) return null
    return { summary: data.summary, updatedAt: data.updatedAt }
  } catch {
    return null
  }
}

/** Invalidate cached summary so next restart regenerates from fresh conversation log */
export function clearChatSummary(chatId: string): void {
  try {
    unlinkSync(filePath(chatId))
  } catch {
    // File may not exist, ignore
  }
}
