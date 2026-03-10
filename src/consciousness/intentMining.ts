/**
 * Intent mining — extract implicit user needs from conversation history
 *
 * Scans conversation.jsonl for messages containing intent-signal keywords
 * (e.g., "如果", "能不能", "我想") that haven't been acted upon (no task
 * created within a nearby time window). Stores up to 50 recent signals.
 *
 * Storage: ~/.cah-data/consciousness/intent-signals.json
 */

import { readFileSync, writeFileSync, mkdirSync, statSync, openSync, readSync, closeSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import { DATA_DIR } from '../store/paths.js'
import { getAllTasks } from '../store/TaskStore.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { ConversationEntry } from '../store/conversationLog.js'

const logger = createLogger('consciousness:intentMining')

const CONVERSATION_LOG_PATH = join(DATA_DIR, 'conversation.jsonl')
const INTENT_SIGNALS_PATH = join(DATA_DIR, 'consciousness', 'intent-signals.json')
const MAX_SIGNALS = 50
const LOOKBACK_DAYS = 30
// If a task was created within 5 minutes of a message, consider it "acted upon"
const TASK_PROXIMITY_MS = 5 * 60 * 1000

// ============ Types ============

export interface IntentSignal {
  id: string
  message: string
  timestamp: string
  keywords: string[]
  status: 'pending' | 'acted'
}

// ============ Keywords ============

// Chinese-only intent keywords. Use compound phrases to reduce false positives.
// English intent mining is not supported — extend this list or use config if needed.
const INTENT_KEYWORDS = [
  '如果能',
  '如果可以',
  '感觉应该',
  '感觉可以',
  '能不能',
  '有没有办法',
  '我想要',
  '我想让',
  '希望能',
  '希望可以',
  '最好能',
  '最好可以',
  '为什么不',
]

// Minimum message length to avoid matching trivial messages
const MIN_MESSAGE_LENGTH = 15

// ============ Storage ============

function readSignals(): IntentSignal[] {
  try {
    const raw = readFileSync(INTENT_SIGNALS_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeSignals(signals: IntentSignal[]): void {
  try {
    mkdirSync(dirname(INTENT_SIGNALS_PATH), { recursive: true })
    writeFileSync(INTENT_SIGNALS_PATH, JSON.stringify(signals, null, 2), 'utf-8')
  } catch (error) {
    logger.warn(`Failed to write intent signals: ${getErrorMessage(error)}`)
  }
}

// ============ Core Logic ============

// Read at most this many bytes from the tail of conversation.jsonl (covers ~30 days for typical usage)
const MAX_READ_BYTES = 2 * 1024 * 1024 // 2MB

function parseConversationEntries(): ConversationEntry[] {
  try {
    let content: string
    let fileSize = 0
    try {
      fileSize = statSync(CONVERSATION_LOG_PATH).size
    } catch {
      // File doesn't exist or can't stat — fall through to readFileSync below
    }

    if (fileSize > MAX_READ_BYTES) {
      // Only read tail portion — conversation.jsonl is append-only, tail = newest
      const fd = openSync(CONVERSATION_LOG_PATH, 'r')
      try {
        const buf = Buffer.alloc(MAX_READ_BYTES)
        readSync(fd, buf, 0, MAX_READ_BYTES, fileSize - MAX_READ_BYTES)
        // Skip first partial line
        const str = buf.toString('utf-8')
        const firstNewline = str.indexOf('\n')
        content = firstNewline >= 0 ? str.slice(firstNewline + 1) : str
      } finally {
        closeSync(fd)
      }
    } else {
      content = readFileSync(CONVERSATION_LOG_PATH, 'utf-8')
    }
    const lines = content.trim().split('\n').filter(Boolean)
    const entries: ConversationEntry[] = []
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as ConversationEntry)
      } catch {
        // skip malformed
      }
    }
    return entries
  } catch (error) {
    logger.debug(`Failed to read conversation log: ${getErrorMessage(error)}`)
    return []
  }
}

function getTaskCreationTimestamps(): number[] {
  try {
    const tasks = getAllTasks() as { createdAt?: string }[]
    return tasks
      .filter(t => t.createdAt)
      .map(t => new Date(t.createdAt!).getTime())
      .filter(ts => !isNaN(ts))
  } catch {
    return []
  }
}

function hasNearbyTask(messageTs: number, sortedTaskTs: number[]): boolean {
  if (sortedTaskTs.length === 0) return false
  // Binary search to find insertion point
  let lo = 0, hi = sortedTaskTs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (sortedTaskTs[mid]! < messageTs) lo = mid + 1
    else hi = mid - 1
  }
  // Check nearest neighbors at the converged position
  if (lo < sortedTaskTs.length && Math.abs(sortedTaskTs[lo]! - messageTs) <= TASK_PROXIMITY_MS) return true
  if (lo > 0 && Math.abs(sortedTaskTs[lo - 1]! - messageTs) <= TASK_PROXIMITY_MS) return true
  return false
}

function extractKeywords(text: string): string[] {
  return INTENT_KEYWORDS.filter(kw => text.includes(kw))
}

/** Mine intent signals from recent conversation history */
export function mineIntentSignals(): IntentSignal[] {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS)
  const cutoffTs = cutoff.getTime()

  const entries = parseConversationEntries()
  const taskTimestamps = getTaskCreationTimestamps().sort((a, b) => a - b)

  // Filter user messages within lookback window
  const userMessages = entries.filter(e => {
    if (e.dir !== 'in') return false
    const ts = new Date(e.ts).getTime()
    return !isNaN(ts) && ts >= cutoffTs
  })

  // Extract signals
  const newSignals: IntentSignal[] = []
  const existingSignals = readSignals()
  const existingTimestamps = new Set(existingSignals.map(s => s.timestamp))

  for (const msg of userMessages) {
    if (msg.text.length < MIN_MESSAGE_LENGTH) continue
    const keywords = extractKeywords(msg.text)
    if (keywords.length === 0) continue
    if (existingTimestamps.has(msg.ts)) continue

    const msgTs = new Date(msg.ts).getTime()
    const acted = hasNearbyTask(msgTs, taskTimestamps)

    newSignals.push({
      id: randomUUID(),
      message: msg.text,
      timestamp: msg.ts,
      keywords,
      status: acted ? 'acted' : 'pending',
    })
  }

  // Merge: keep existing + add new, cap at MAX_SIGNALS, newest first
  const merged = [...existingSignals, ...newSignals]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, MAX_SIGNALS)

  writeSignals(merged)

  logger.info(`Mined ${newSignals.length} new intent signals (${merged.filter(s => s.status === 'pending').length} pending)`)
  return merged
}

/** Load stored intent signals without re-mining */
export function loadIntentSignals(): IntentSignal[] {
  return readSignals()
}

/** Load only pending signals (for self-drive consumption) */
export function loadPendingIntentSignals(): IntentSignal[] {
  return readSignals().filter(s => s.status === 'pending')
}

/** Mark a signal as acted upon */
export function markSignalActed(id: string): boolean {
  const signals = readSignals()
  const signal = signals.find(s => s.id === id)
  if (!signal || signal.status !== 'pending') return false
  signal.status = 'acted'
  writeSignals(signals)
  return true
}
