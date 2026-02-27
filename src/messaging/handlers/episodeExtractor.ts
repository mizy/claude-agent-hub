/**
 * Episode extractor — detects conversation endings and triggers
 * episodic memory extraction asynchronously.
 *
 * Triggers:
 * 1. Timeout: 5 min no new message in a chat
 * 2. Explicit ending: "好的" / "谢谢" / "/done" / "OK" etc. (only if turns >= 3)
 * 3. Task creation: user creates a cah task from chat, prior conversation = episode
 */

import { extractEpisode } from '../../memory/index.js'
import type { EpisodeMessage, ExtractEpisodeParams } from '../../memory/index.js'
import { loadConfig } from '../../config/loadConfig.js'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'

const logger = createLogger('episode-extractor')

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const MIN_TURNS_FOR_EXPLICIT_END = 3

let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS

// Patterns that signal conversation end
const END_PATTERNS = /^(?:好的|谢谢|就这样|ok|OK|Ok|thanks|thank you|收到|明白了|了解|done|\/done)[!！。.~～]*$/i

interface ConversationTracker {
  messages: EpisodeMessage[]
  turnCount: number
  timer: ReturnType<typeof setTimeout> | null
  extracted: boolean
  platform: string
}

// Per-chatId conversation tracking
const trackers = new Map<string, ConversationTracker>()

// Track which chatIds have already been extracted (prevent duplicates)
const extractedSet = new Set<string>()

function getTracker(chatId: string, platform = 'lark'): ConversationTracker {
  let tracker = trackers.get(chatId)
  if (!tracker) {
    tracker = { messages: [], turnCount: 0, timer: null, extracted: false, platform }
    trackers.set(chatId, tracker)
  }
  return tracker
}

function clearTimer(tracker: ConversationTracker): void {
  if (tracker.timer) {
    clearTimeout(tracker.timer)
    tracker.timer = null
  }
}

async function isEpisodicEnabled(): Promise<boolean> {
  try {
    const config = await loadConfig()
    return config.memory.episodic.enabled
  } catch {
    return false
  }
}

async function doExtract(chatId: string, tracker: ConversationTracker, trigger: string): Promise<void> {
  if (tracker.extracted || tracker.messages.length < 4) return
  tracker.extracted = true
  extractedSet.add(chatId)

  logger.info(`Episode extraction triggered: ${trigger} [${chatId.slice(0, 8)}] (${tracker.turnCount} turns)`)

  const params: ExtractEpisodeParams = {
    messages: [...tracker.messages],
    platform: tracker.platform as 'lark' | 'telegram' | 'cli',
    conversationId: chatId,
  }

  try {
    const episode = await extractEpisode(params)
    if (episode) {
      logger.info(`Episode saved: ${episode.id} [${chatId.slice(0, 8)}]`)
    }
  } catch (err) {
    logger.debug(`Episode extraction failed: ${getErrorMessage(err)}`)
  }
}

function startIdleTimer(chatId: string, tracker: ConversationTracker): void {
  clearTimer(tracker)
  tracker.timer = setTimeout(() => {
    isEpisodicEnabled().then(enabled => {
      if (enabled && !tracker.extracted) {
        doExtract(chatId, tracker, 'idle-timeout').catch(() => {})
      }
    }).catch(() => {})
  }, idleTimeoutMs)
}

/**
 * Track a conversation turn for episodic memory extraction.
 * Call after each successful chat turn.
 */
export function trackEpisodeTurn(
  chatId: string,
  userText: string,
  aiResponse: string,
  platform?: string,
): void {
  const tracker = getTracker(chatId, platform)

  // If already extracted for this conversation cycle, start fresh
  if (tracker.extracted) {
    tracker.messages = []
    tracker.turnCount = 0
    tracker.extracted = false
    extractedSet.delete(chatId)
  }

  tracker.messages.push({ role: 'user', content: userText })
  tracker.messages.push({ role: 'assistant', content: aiResponse })
  tracker.turnCount++

  // Cap message buffer
  if (tracker.messages.length > 40) {
    tracker.messages = tracker.messages.slice(-40)
  }

  // Reset idle timer
  startIdleTimer(chatId, tracker)

  // Check explicit end patterns (only if enough turns)
  if (tracker.turnCount >= MIN_TURNS_FOR_EXPLICIT_END && END_PATTERNS.test(userText.trim())) {
    isEpisodicEnabled().then(enabled => {
      if (enabled) {
        doExtract(chatId, tracker, 'explicit-end').catch(() => {})
      }
    }).catch(() => {})
  }
}

/**
 * Trigger episode extraction when a task is created from chat.
 * The prior conversation becomes an episode.
 */
export function triggerEpisodeOnTaskCreation(chatId: string): void {
  const tracker = trackers.get(chatId)
  if (!tracker || tracker.extracted || tracker.messages.length < 4) return

  clearTimer(tracker)
  isEpisodicEnabled().then(enabled => {
    if (enabled) {
      doExtract(chatId, tracker, 'task-creation').catch(() => {})
    }
  }).catch(() => {})
}

/**
 * Force episode extraction for a chatId (e.g., on /new session clear).
 */
export function flushEpisode(chatId: string): void {
  const tracker = trackers.get(chatId)
  if (!tracker || tracker.extracted || tracker.messages.length < 4) return

  clearTimer(tracker)
  isEpisodicEnabled().then(enabled => {
    if (enabled) {
      doExtract(chatId, tracker, 'session-clear').catch(() => {})
    }
  }).catch(() => {})
}

/**
 * Clear tracker for a chatId (on session destroy).
 */
export function clearEpisodeTracker(chatId: string): void {
  const tracker = trackers.get(chatId)
  if (tracker) {
    clearTimer(tracker)
    trackers.delete(chatId)
  }
  extractedSet.delete(chatId)
}

/**
 * Cleanup all trackers (on daemon shutdown).
 */
export function destroyEpisodeTrackers(): void {
  for (const tracker of trackers.values()) {
    clearTimer(tracker)
  }
  trackers.clear()
  extractedSet.clear()
}
