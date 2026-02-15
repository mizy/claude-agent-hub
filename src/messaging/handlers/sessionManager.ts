/**
 * Chat session state management
 * Handles per-chatId sessions, expiry cleanup, message queuing, and disk persistence
 */

import { join } from 'path'
import { createLogger } from '../../shared/logger.js'
import { readJson, writeJson } from '../../store/readWriteJson.js'
import { DATA_DIR } from '../../store/paths.js'
import type { ChatSession } from './types.js'

const logger = createLogger('session-manager')

const SESSION_TIMEOUT_MS = 60 * 60 * 1000 // 60 minutes — longer timeout maximizes Claude API prompt cache hits
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')

const sessions = new Map<string, ChatSession>()

// Per-chatId message queue ensures serial processing within a session
const chatQueues = new Map<string, Promise<void>>()

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureCleanupTimer(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    let changed = false
    for (const [chatId, session] of sessions) {
      if (now - session.lastActiveAt > SESSION_TIMEOUT_MS) {
        sessions.delete(chatId)
        changed = true
        logger.info(`Session expired for chat ${chatId}`)
      }
    }
    if (changed) persistSessions()
    if (sessions.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer)
      cleanupTimer = null
    }
  }, 60_000)
}

// ── Disk persistence ──

function persistSessions(): void {
  try {
    const data: Record<string, ChatSession> = {}
    for (const [chatId, session] of sessions) {
      data[chatId] = session
    }
    writeJson(SESSIONS_FILE, data)
  } catch (e) {
    logger.debug(`Failed to persist sessions: ${e instanceof Error ? e.message : e}`)
  }
}

/** Load sessions from disk. Call on daemon startup to restore chat continuity. */
export function loadSessions(): void {
  const data = readJson<Record<string, ChatSession>>(SESSIONS_FILE)
  if (!data) return

  const now = Date.now()
  let restored = 0
  for (const [chatId, session] of Object.entries(data)) {
    if (now - session.lastActiveAt > SESSION_TIMEOUT_MS) continue
    sessions.set(chatId, session)
    restored++
  }
  if (restored > 0) {
    ensureCleanupTimer()
    logger.info(`Restored ${restored} chat session(s) from disk`)
  }
}

/** Get session for a chatId */
export function getSession(chatId: string): ChatSession | undefined {
  return sessions.get(chatId)
}

/** Update or create session, starts cleanup timer, persists to disk */
export function setSession(chatId: string, sessionId: string): void {
  sessions.set(chatId, { sessionId, lastActiveAt: Date.now() })
  ensureCleanupTimer()
  persistSessions()
}

/** Clear session for a chatId */
export function clearSession(chatId: string): boolean {
  const result = sessions.delete(chatId)
  if (result) persistSessions()
  return result
}

/**
 * Enqueue a task for a chatId, ensuring serial execution per chat.
 * Returns the task promise (rejects if the task rejects).
 */
export function enqueueChat(chatId: string, fn: () => Promise<void>): Promise<void> {
  const prev = chatQueues.get(chatId) ?? Promise.resolve()
  const task = prev.then(fn)
  // Swallow errors so next queued message isn't blocked
  const tail = task.catch(() => {})
  chatQueues.set(chatId, tail)
  // Clean up queue entry when done
  tail.then(() => {
    if (chatQueues.get(chatId) === tail) chatQueues.delete(chatId)
  })
  return task
}

/**
 * Cleanup in-memory sessions and stop the timer.
 * Disk file is preserved so sessions survive daemon restart.
 */
export function destroySessions(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
  sessions.clear()
  chatQueues.clear()
}
