/**
 * Chat memory extraction trigger — accumulates conversation turns
 * and fires memory extraction asynchronously every N turns.
 *
 * Features:
 * - Buffer persistence to survive daemon restarts
 * - Keyword-triggered immediate extraction (记住, remember, etc.)
 * - Decision/preference keyword detection
 * - Long message detection
 * - @backend switch detection
 */

import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { extractChatMemory } from '../../memory/index.js'
import type { ChatMessage } from '../../memory/index.js'
import { DATA_DIR } from '../../store/paths.js'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { loadConfig } from '../../config/loadConfig.js'

const logger = createLogger('chat-memory-trigger')

const DEFAULT_EXTRACT_EVERY_N_TURNS = 5
const MAX_MESSAGES_PER_CHAT = 20
const BUFFER_FILE = join(DATA_DIR, 'chat-buffers.json')
const LONG_MESSAGE_THRESHOLD = 200
const SAVE_DEBOUNCE_MS = 3_000

// Keywords that signal user wants something remembered
const REMEMBER_KEYWORDS = /(?:记住|以后|别忘了|下次注意|remember|don'?t forget|keep in mind|注意一下|记下来)/i

// Decision and preference keywords
const DECISION_KEYWORDS = /(?:决定|改成|换成|选|用了|切换到|migrate to|switch to|go with|prefer)/i

// Negation/correction keywords
const CORRECTION_KEYWORDS = /(?:不要|别|不是|错了|不对|wrong|don'?t|stop using|shouldn'?t)/i

// Emphasis keywords
const EMPHASIS_KEYWORDS = /(?:重要|关键|必须|一定|务必|critical|important|must|always|never)/i

// @backend syntax detection
const BACKEND_SWITCH_PATTERN = /^[@/](?:backend:|use\s+)?(\w+)/i

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

function saveBuffersNow(): void {
  try {
    const data: Record<string, ChatBuffer> = {}
    for (const [chatId, buf] of chatBuffers) {
      data[chatId] = buf
    }
    mkdirSync(join(DATA_DIR), { recursive: true })
    writeFileSync(BUFFER_FILE, JSON.stringify(data), 'utf-8')
  } catch (err) {
    logger.debug(`Failed to persist chat buffers: ${getErrorMessage(err)}`)
  }
}

// Debounced save: coalesce multiple writes within SAVE_DEBOUNCE_MS
let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSaveBuffers(): void {
  if (saveTimer) return // already scheduled
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveBuffersNow()
  }, SAVE_DEBOUNCE_MS)
}

/** Flush pending debounced save immediately (e.g. on shutdown) */
export function flushBufferSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    saveBuffersNow()
  }
}

// Restore buffers on module load
loadBuffers()

/**
 * Check if user text matches any trigger keywords beyond the basic remember keywords.
 * Returns the trigger reason or null.
 */
function detectContentTrigger(userText: string, extraKeywords?: string[]): string | null {
  if (REMEMBER_KEYWORDS.test(userText)) return 'remember-keyword'
  if (DECISION_KEYWORDS.test(userText)) return 'decision'
  if (CORRECTION_KEYWORDS.test(userText)) return 'correction'
  if (EMPHASIS_KEYWORDS.test(userText)) return 'emphasis'
  if (BACKEND_SWITCH_PATTERN.test(userText)) return 'backend-switch'
  if (userText.length > LONG_MESSAGE_THRESHOLD) return 'long-message'

  // Check extra configured keywords
  if (extraKeywords?.length) {
    const pattern = new RegExp(`(?:${extraKeywords.join('|')})`, 'i')
    if (pattern.test(userText)) return 'config-keyword'
  }

  return null
}

/** Cached config for extractEveryNTurns and extra keywords */
let cachedExtractConfig: { extractEveryNTurns: number; extraKeywords: string[] } | null = null

async function getExtractConfig(): Promise<{ extractEveryNTurns: number; extraKeywords: string[] }> {
  if (cachedExtractConfig) return cachedExtractConfig
  try {
    const config = await loadConfig()
    const cm = config.memory.chatMemory
    cachedExtractConfig = {
      extractEveryNTurns: cm.extractEveryNTurns ?? DEFAULT_EXTRACT_EVERY_N_TURNS,
      extraKeywords: cm.triggerKeywords ?? [],
    }
  } catch {
    cachedExtractConfig = { extractEveryNTurns: DEFAULT_EXTRACT_EVERY_N_TURNS, extraKeywords: [] }
  }
  return cachedExtractConfig
}

/** Reset config cache (e.g. on config reload) */
export function resetExtractConfigCache(): void {
  cachedExtractConfig = null
}

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

  // Async: load config and check triggers
  getExtractConfig().then(({ extractEveryNTurns, extraKeywords }) => {
    const triggerReason = detectContentTrigger(userText, extraKeywords)
    const periodicTrigger = buffer!.turnCount >= extractEveryNTurns

    if (triggerReason || periodicTrigger) {
      const messagesToExtract = [...buffer!.messages]
      buffer!.turnCount = 0

      // Fire-and-forget
      extractChatMemory(messagesToExtract, { chatId, platform }).catch(err => {
        logger.debug(`Chat memory extraction failed: ${getErrorMessage(err)}`)
      })

      if (triggerReason) {
        logger.info(`关键词触发记忆提取: ${triggerReason} [${chatId.slice(0, 8)}]`)
      }
    }
  }).catch(err => {
    logger.debug(`Extract config load failed: ${getErrorMessage(err)}`)
  })

  // Synchronous check for immediate keyword feedback to caller
  const keywordMatch = REMEMBER_KEYWORDS.test(userText)

  // Debounced persist (coalesces rapid consecutive turns)
  scheduleSaveBuffers()

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
  saveBuffersNow() // immediate on explicit flush

  extractChatMemory(messagesToExtract, { chatId }).catch(err => {
    logger.debug(`Chat memory flush failed: ${getErrorMessage(err)}`)
  })
}

/**
 * Clear all buffers (on daemon shutdown).
 */
export function clearChatMemoryBuffers(): void {
  flushBufferSave()
  chatBuffers.clear()
}
