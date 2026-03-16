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
import { getAllMemories } from '../../store/MemoryStore.js'
import { loadConfig } from '../../config/loadConfig.js'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'

const logger = createLogger('episode-extractor')

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_MIN_TURNS_FOR_EXPLICIT_END = 3

// Patterns that signal conversation end
const END_PATTERNS = /^(?:好的|谢谢|就这样|ok|OK|Ok|thanks|thank you|收到|明白了|了解|done|\/done)[!！。.~～]*$/i

interface ConversationTracker {
  messages: EpisodeMessage[]
  turnCount: number
  timer: ReturnType<typeof setTimeout> | null
  timerGen: number
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
    tracker = { messages: [], turnCount: 0, timer: null, timerGen: 0, extracted: false, platform }
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

interface EpisodicConfig {
  enabled: boolean
  idleTimeoutMs: number
  minTurnsForExplicitEnd: number
}

async function getEpisodicConfig(): Promise<EpisodicConfig> {
  try {
    const config = await loadConfig()
    const e = config.memory.episodic
    return {
      enabled: e.enabled,
      idleTimeoutMs: e.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      minTurnsForExplicitEnd: e.minTurnsForExplicitEnd ?? DEFAULT_MIN_TURNS_FOR_EXPLICIT_END,
    }
  } catch {
    return { enabled: false, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS, minTurnsForExplicitEnd: DEFAULT_MIN_TURNS_FOR_EXPLICIT_END }
  }
}

/** Find memory IDs created in the last hour for this chatId */
function findRecentMemoryIds(chatId: string): string[] {
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  return getAllMemories()
    .filter(m =>
      m.source.chatId === chatId &&
      new Date(m.createdAt).getTime() > oneHourAgo
    )
    .map(m => m.id)
}

async function doExtract(chatId: string, tracker: ConversationTracker, trigger: string): Promise<void> {
  if (tracker.extracted || tracker.messages.length < 4) return

  logger.info(`Episode extraction triggered: ${trigger} [${chatId.slice(0, 8)}] (${tracker.turnCount} turns)`)

  const relatedMemoryIds = findRecentMemoryIds(chatId)

  const params: ExtractEpisodeParams = {
    messages: [...tracker.messages],
    platform: tracker.platform as 'lark' | 'telegram' | 'cli',
    conversationId: chatId,
    relatedMemoryIds,
  }

  try {
    const episode = await extractEpisode(params)
    if (episode) {
      logger.info(`Episode saved: ${episode.id} [${chatId.slice(0, 8)}]`)
    }
    // Mark as extracted only on success — failed extractions can be retried
    tracker.extracted = true
    extractedSet.add(chatId)
  } catch (err) {
    logger.debug(`Episode extraction failed: ${getErrorMessage(err)}`)
  }
}

function startIdleTimer(chatId: string, tracker: ConversationTracker): void {
  clearTimer(tracker)
  // Bump generation so stale async callbacks are discarded
  const gen = ++tracker.timerGen
  getEpisodicConfig().then(({ enabled, idleTimeoutMs }) => {
    if (!enabled || tracker.timerGen !== gen) return
    tracker.timer = setTimeout(() => {
      if (!tracker.extracted) {
        doExtract(chatId, tracker, 'idle-timeout').catch(() => {})
      }
    }, idleTimeoutMs)
  }).catch(() => {})
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
  getEpisodicConfig().then(({ enabled, minTurnsForExplicitEnd }) => {
    if (enabled && tracker.turnCount >= minTurnsForExplicitEnd && END_PATTERNS.test(userText.trim())) {
      doExtract(chatId, tracker, 'explicit-end').catch(() => {})
    }
  }).catch(() => {})
}

/**
 * Trigger episode extraction when a task is created from chat.
 * The prior conversation becomes an episode.
 */
export function triggerEpisodeOnTaskCreation(chatId: string): void {
  const tracker = trackers.get(chatId)
  if (!tracker || tracker.extracted || tracker.messages.length < 4) return

  clearTimer(tracker)
  getEpisodicConfig().then(({ enabled }) => {
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
  getEpisodicConfig().then(({ enabled }) => {
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
 * Flush all pending episodes (best-effort, with timeout).
 * Call before destroyEpisodeTrackers on graceful shutdown to avoid data loss.
 */
export async function flushAllEpisodes(timeoutMs = 8000): Promise<void> {
  const pending: Promise<void>[] = []
  for (const [chatId, tracker] of trackers) {
    if (tracker.extracted || tracker.messages.length < 4) continue
    clearTimer(tracker)
    pending.push(doExtract(chatId, tracker, 'shutdown-flush'))
  }
  if (pending.length === 0) return
  logger.info(`Flushing ${pending.length} pending episode(s) before shutdown`)
  await Promise.race([
    Promise.allSettled(pending),
    new Promise(r => setTimeout(r, timeoutMs)),
  ])
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
