/**
 * Chat memory extraction trigger — accumulates conversation turns
 * and fires memory extraction asynchronously every N turns.
 *
 * Features:
 * - Buffer persistence to survive daemon restarts
 * - Keyword-triggered immediate extraction (记住, remember, etc.)
 */

import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { extractChatMemory } from '../../memory/index.js'
import type { ChatMessage } from '../../memory/index.js'
import { DATA_DIR } from '../../store/paths.js'
import { createLogger } from '../../shared/logger.js'

const logger = createLogger('chat-memory-trigger')

const EXTRACT_EVERY_N_TURNS = 5
const MAX_MESSAGES_PER_CHAT = 20
const BUFFER_FILE = join(DATA_DIR, 'chat-buffers.json')

// Keywords that signal user wants something remembered
const REMEMBER_KEYWORDS = /(?:记住|以后|别忘了|下次注意|remember|don'?t forget|keep in mind|注意一下|记下来)/i

interface ChatBuffer {
  messages: ChatMessage[]
  turnCount: number
}

// Per-chatId message buffer
const chatBuffers = new Map<string, ChatBuffer>()

// ── Persistence ──

function loadBuffers(): void {
  try {
    const raw = readFileSync(BUFFER_FILE, 'utf-8')
    const data = JSON.parse(raw) as Record<string, ChatBuffer>
    for (const [chatId, buf] of Object.entries(data)) {
      if (buf.messages?.length > 0) {
        chatBuffers.set(chatId, buf)
      }
    }
    logger.debug(`Restored ${chatBuffers.size} chat buffers from disk`)
  } catch {
    // File doesn't exist or is corrupt — start fresh
  }
}

function saveBuffers(): void {
  try {
    const data: Record<string, ChatBuffer> = {}
    for (const [chatId, buf] of chatBuffers) {
      data[chatId] = buf
    }
    mkdirSync(join(DATA_DIR), { recursive: true })
    writeFileSync(BUFFER_FILE, JSON.stringify(data), 'utf-8')
  } catch (err) {
    logger.debug(`Failed to persist chat buffers: ${err instanceof Error ? err.message : err}`)
  }
}

// Restore buffers on module load
loadBuffers()

/**
 * Called after each successful chat turn. Accumulates messages and
 * triggers memory extraction every N turns (fire-and-forget).
 *
 * Returns true if keyword-triggered immediate extraction was fired.
 */
export function triggerChatMemoryExtraction(
  chatId: string,
  userText: string,
  aiResponse: string,
  platform?: string,
): boolean {
  let buffer = chatBuffers.get(chatId)
  if (!buffer) {
    buffer = { messages: [], turnCount: 0 }
    chatBuffers.set(chatId, buffer)
  }

  buffer.messages.push({ role: 'user', text: userText })
  buffer.messages.push({ role: 'assistant', text: aiResponse })
  buffer.turnCount++

  // Trim old messages if buffer grows too large
  if (buffer.messages.length > MAX_MESSAGES_PER_CHAT * 2) {
    buffer.messages = buffer.messages.slice(-MAX_MESSAGES_PER_CHAT * 2)
  }

  // Check for keyword-triggered immediate extraction
  const keywordMatch = REMEMBER_KEYWORDS.test(userText)

  if (keywordMatch || buffer.turnCount >= EXTRACT_EVERY_N_TURNS) {
    const messagesToExtract = [...buffer.messages]
    buffer.turnCount = 0

    // Fire-and-forget
    extractChatMemory(messagesToExtract, { chatId, platform }).catch(err => {
      logger.debug(`Chat memory extraction failed: ${err instanceof Error ? err.message : err}`)
    })

    if (keywordMatch) {
      logger.info(`🔑 Keyword-triggered memory extraction [${chatId.slice(0, 8)}]`)
    }
  }

  // Persist after every turn
  saveBuffers()

  return keywordMatch
}

/**
 * Force extraction for a chatId (e.g., on session clear).
 */
export function flushChatMemory(chatId: string): void {
  const buffer = chatBuffers.get(chatId)
  if (!buffer || buffer.messages.length < 4) return

  const messagesToExtract = [...buffer.messages]
  chatBuffers.delete(chatId)
  saveBuffers()

  extractChatMemory(messagesToExtract, { chatId }).catch(err => {
    logger.debug(`Chat memory flush failed: ${err instanceof Error ? err.message : err}`)
  })
}

/**
 * Clear all buffers (on daemon shutdown).
 */
export function clearChatMemoryBuffers(): void {
  chatBuffers.clear()
}
