/**
 * Chat session state management
 * Handles per-chatId sessions, expiry cleanup, message queuing, and disk persistence
 */

import { join } from 'path'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { readJson, writeJson } from '../../store/readWriteJson.js'
import { DATA_DIR } from '../../store/paths.js'
import type { ChatSession } from './types.js'
import type { SessionConfig } from '../../config/schema.js'

const logger = createLogger('session-manager')

const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')

// Default config values (overridden by configureSession)
let sessionConfig: SessionConfig = {
  timeoutMinutes: 60,
  maxTurns: 10,
  maxEstimatedTokens: 50_000,
  maxSessions: 200,
}

/** Configure session parameters from config. Call once at startup. */
export function configureSession(config: SessionConfig): void {
  sessionConfig = config
  logger.info(`Session config: timeout=${config.timeoutMinutes}m, maxTurns=${config.maxTurns}, maxTokens=${config.maxEstimatedTokens}, maxSessions=${config.maxSessions}`)
}

function getTimeoutMs(): number {
  return sessionConfig.timeoutMinutes * 60 * 1000
}

const sessions = new Map<string, ChatSession>()

// Per-chatId message queue ensures serial processing within a session
const chatQueues = new Map<string, Promise<void>>()

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureCleanupTimer(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    const timeoutMs = getTimeoutMs()
    let changed = false
    for (const [chatId, session] of sessions) {
      if (now - session.lastActiveAt > timeoutMs) {
        sessions.delete(chatId)
        changed = true
        logger.info(`Session expired for chat ${chatId}`)
      }
    }
    if (changed) schedulePersist()
    if (sessions.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer)
      cleanupTimer = null
    }
  }, 60_000)
}

// ── Debounced disk persistence ──

let persistTimer: ReturnType<typeof setTimeout> | null = null
const PERSIST_DELAY_MS = 2000

function schedulePersist(): void {
  if (persistTimer) return // already scheduled
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistSessionsNow()
  }, PERSIST_DELAY_MS)
}

function persistSessionsNow(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  try {
    const data: Record<string, ChatSession> = {}
    for (const [chatId, session] of sessions) {
      data[chatId] = session
    }
    writeJson(SESSIONS_FILE, data)
  } catch (e) {
    logger.debug(`Failed to persist sessions: ${getErrorMessage(e)}`)
  }
}

// ── LRU eviction ──

/** Evict oldest sessions when over maxSessions limit */
function evictIfNeeded(): void {
  const max = sessionConfig.maxSessions
  if (sessions.size <= max) return

  // Sort by lastActiveAt ascending (oldest first)
  const entries = [...sessions.entries()].sort((a, b) => a[1].lastActiveAt - b[1].lastActiveAt)
  const toEvict = entries.slice(0, sessions.size - max)
  for (const [chatId] of toEvict) {
    sessions.delete(chatId)
    logger.info(`Session evicted (LRU) for chat ${chatId.slice(0, 8)}`)
  }
}

// ── Public API ──

/** Load sessions from disk. Call on daemon startup to restore chat continuity. */
export function loadSessions(): void {
  const data = readJson<Record<string, ChatSession>>(SESSIONS_FILE)
  if (!data) return

  const now = Date.now()
  const timeoutMs = getTimeoutMs()
  let restored = 0
  for (const [chatId, session] of Object.entries(data)) {
    if (now - session.lastActiveAt > timeoutMs) continue
    // Backward compat: old sessions lack turnCount/estimatedTokens
    session.turnCount ??= 0
    session.estimatedTokens ??= 0
    sessions.set(chatId, session)
    restored++
  }
  if (restored > 0) {
    evictIfNeeded()
    ensureCleanupTimer()
    logger.info(`Restored ${restored} chat session(s) from disk`)
  }
}

/** Get session for a chatId */
export function getSession(chatId: string): ChatSession | undefined {
  return sessions.get(chatId)
}

/** Update or create session, starts cleanup timer, persists to disk */
export function setSession(chatId: string, sessionId: string, backendType?: string): void {
  const existing = sessions.get(chatId)
  sessions.set(chatId, { sessionId, lastActiveAt: Date.now(), turnCount: 0, estimatedTokens: 0, modelOverride: existing?.modelOverride, backendOverride: existing?.backendOverride, sessionBackendType: backendType })
  evictIfNeeded()
  ensureCleanupTimer()
  schedulePersist()
}

/** Clear session for a chatId */
export function clearSession(chatId: string): boolean {
  const result = sessions.delete(chatId)
  if (result) schedulePersist()
  return result
}

/** Set model override for a chatId. Pass undefined to clear (restore auto). */
export function setModelOverride(chatId: string, model: string | undefined): void {
  const session = sessions.get(chatId)
  if (session) {
    session.modelOverride = model
  } else {
    // No session yet — store a placeholder so override takes effect on next chat
    sessions.set(chatId, { sessionId: '', lastActiveAt: Date.now(), turnCount: 0, estimatedTokens: 0, modelOverride: model })
    evictIfNeeded()
    ensureCleanupTimer()
  }
  schedulePersist()
}

/** Get model override for a chatId */
export function getModelOverride(chatId: string): string | undefined {
  return sessions.get(chatId)?.modelOverride
}

/** Set backend override for a chatId. Pass undefined to clear (restore default). */
export function setBackendOverride(chatId: string, backend: string | undefined): void {
  const session = sessions.get(chatId)
  if (session) {
    session.backendOverride = backend
  } else {
    sessions.set(chatId, { sessionId: '', lastActiveAt: Date.now(), turnCount: 0, estimatedTokens: 0, backendOverride: backend })
    evictIfNeeded()
    ensureCleanupTimer()
  }
  schedulePersist()
}

/** Get backend override for a chatId */
export function getBackendOverride(chatId: string): string | undefined {
  return sessions.get(chatId)?.backendOverride
}

/** Rough token estimate from char count (~3 chars/token average for mixed CJK/Latin) */
function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 3)
}

/** Check if a session should be reset (too many turns or tokens) */
export function shouldResetSession(chatId: string): boolean {
  const session = sessions.get(chatId)
  if (!session) return false
  return session.turnCount > sessionConfig.maxTurns || session.estimatedTokens > sessionConfig.maxEstimatedTokens
}

/** Increment turn count and accumulate estimated tokens after a chat round.
 * Does NOT delete the session here — shouldResetSession() will trigger reset
 * at the start of the next chat turn, allowing chatHandler to notify the user. */
export function incrementTurn(chatId: string, inputLen: number, outputLen: number): void {
  const session = sessions.get(chatId)
  if (!session) return
  session.turnCount++
  session.estimatedTokens += estimateTokens(inputLen) + estimateTokens(outputLen)
  session.lastActiveAt = Date.now()
  schedulePersist()
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

/** Get session count for diagnostics */
export function getSessionCount(): number {
  return sessions.size
}

/**
 * Cleanup in-memory sessions and stop the timer.
 * Flush pending persist to disk so sessions survive daemon restart.
 */
export function destroySessions(): void {
  // Flush any pending debounced persist
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
    persistSessionsNow()
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
  sessions.clear()
  chatQueues.clear()
}
