/**
 * Chat session state management
 * Handles per-chatId sessions, expiry cleanup, message queuing, and disk persistence
 * Also manages web chat session files (chat-sessions/) for unified session access
 */

import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { readdir, readFile as readFileAsync } from 'fs/promises'
import { randomUUID } from 'crypto'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { readJson, writeJson } from '../../store/readWriteJson.js'
import { DATA_DIR } from '../../store/paths.js'
import type { ChatSession } from './types.js'
import type { SessionConfig } from '../../config/schema.js'
import { appendEntry } from '../../consciousness/index.js'
import { generateSessionEndInsight } from '../../consciousness/generateSummary.js'
import type { ConversationMessage } from '../../consciousness/generateSummary.js'
import { addActiveThought } from '../../consciousness/activeThoughts.js'

const logger = createLogger('session-manager')

const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')

// Default config values (overridden by configureSession)
let sessionConfig: SessionConfig = {
  timeoutMinutes: 60,
  maxSessions: 200,
  maxWebMessages: 200,
}

/** Configure session parameters from config. Call once at startup. */
export function configureSession(config: SessionConfig): void {
  sessionConfig = config
  logger.info(`Session config: timeout=${config.timeoutMinutes}m, maxSessions=${config.maxSessions}`)
}

function getTimeoutMs(): number {
  return sessionConfig.timeoutMinutes * 60 * 1000
}

/**
 * Fire-and-forget consciousness write when a session ends.
 * Tries to load web session messages for summary; falls back to simple event.
 */
// Track chatIds with pending async insight generation to avoid duplicate session_end entries
const pendingInsights = new Set<string>()

function writeSessionEndConsciousness(chatId: string, session: ChatSession, reason: string): void {
  try {
    const webSession = loadWebSession(chatId)
    if (webSession && webSession.messages.length > 0) {
      const messages = webSession.messages.map(m => ({
        role: m.role,
        text: m.content,
      }))
      // Mark as pending so destroySessions won't duplicate
      pendingInsights.add(chatId)
      // Fire-and-forget — don't await, don't block exit
      generateSessionEndInsight(messages).then(insight => {
        pendingInsights.delete(chatId)
        if (!insight.summary) return
        appendEntry({
          ts: new Date().toISOString(),
          type: 'session_end',
          content: insight.summary,
          metadata: {
            channel: chatId,
            messageCount: webSession.messages.length,
            duration: Date.now() - new Date(webSession.createdAt).getTime(),
            emotionalShift: insight.emotionalShift,
            unfinishedThoughts: insight.unfinishedThoughts,
            triggerEvent: reason,
          },
        })
        // Extract unfinished thoughts into active thoughts pool
        extractActiveThoughts(insight.unfinishedThoughts, chatId)
      }).catch(e => {
        pendingInsights.delete(chatId)
        logger.debug(`Consciousness session-end insight failed: ${getErrorMessage(e)}`)
      })
    } else if (session.turnCount > 0) {
      appendEntry({
        ts: new Date().toISOString(),
        type: 'session_end',
        content: `会话结束（${reason}），${session.turnCount}轮对话`,
        metadata: {
          channel: chatId,
          messageCount: session.turnCount,
          emotionalShift: 'neutral→neutral',
          triggerEvent: reason,
        },
      })
    }

  } catch {
    // Best-effort — never throw
  }
}

/** Extract unfinished thoughts from session-end insight into active thoughts pool (batch write) */
function extractActiveThoughts(unfinishedThoughts: string[] | undefined, chatId: string): void {
  if (!unfinishedThoughts?.length) return
  try {
    const source = `session:${chatId.slice(0, 8)}`
    const validThoughts = unfinishedThoughts
      .map(t => t.trim())
      .filter(Boolean)
    // Batch: only the last addActiveThought triggers a write (they all read-push-write internally)
    // Acceptable for 1-3 items; truly batch API would require refactoring addActiveThought
    for (const thought of validThoughts) {
      addActiveThought({ thought, priority: 'medium', source })
    }
  } catch {
    // Best-effort
  }
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
        writeSessionEndConsciousness(chatId, session, '超时')
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

/** Load sessions from disk. Call on daemon startup to restore chat continuity.
 *  Clears sessionId so next message starts a fresh CLI session — avoids loading
 *  bloated compact context. Our own history summary + memory provides enough context. */
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
    // Clear sessionId — always start fresh CLI session after restart.
    // Claude CLI --resume loads full compact context (often MB-sized),
    // which causes massive TTFT for simple messages.
    // Our history summary + memory retrieval provides sufficient context.
    session.sessionId = ''
    session.turnCount = 0
    session.estimatedTokens = 0
    sessions.set(chatId, session)
    restored++
  }
  if (restored > 0) {
    evictIfNeeded()
    ensureCleanupTimer()
    logger.info(`Restored ${restored} chat session(s) from disk (sessionIds cleared for fresh start)`)
  }
}

/** Get session for a chatId */
export function getSession(chatId: string): ChatSession | undefined {
  return sessions.get(chatId)
}

/** Update or create session, starts cleanup timer, persists to disk */
export function setSession(chatId: string, sessionId: string, backendType?: string): void {
  const existing = sessions.get(chatId)
  // Preserve turn/token counters when continuing the same session (same sessionId)
  // Only reset when creating a genuinely new session
  const isSameSession = existing && existing.sessionId === sessionId
  // Use 'default' as explicit marker when no backendType is provided
  // This allows proper backend change detection (undefined vs 'default' vs 'codebuddy')
  sessions.set(chatId, {
    sessionId,
    lastActiveAt: Date.now(),
    turnCount: isSameSession ? existing.turnCount : 0,
    estimatedTokens: isSameSession ? existing.estimatedTokens : 0,
    modelOverride: existing?.modelOverride,
    backendOverride: existing?.backendOverride,
    sessionBackendType: backendType ?? 'default',
  })
  evictIfNeeded()
  ensureCleanupTimer()
  schedulePersist()
}

/** Clear session for a chatId */
export function clearSession(chatId: string): boolean {
  const session = sessions.get(chatId)
  if (session) {
    writeSessionEndConsciousness(chatId, session, '主动清除')
  }
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

/** Rough token estimate: ASCII ~4 chars/token, CJK ~1 char/token */
function estimateTokens(text: string): number {
  let tokens = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    // CJK Unified Ideographs + common CJK ranges
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext A
      (code >= 0x3000 && code <= 0x303f) || // CJK Symbols
      (code >= 0xff00 && code <= 0xffef) || // Fullwidth Forms
      (code >= 0xac00 && code <= 0xd7af)    // Hangul
    ) {
      tokens += 1
    } else {
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}

/** Increment turn count and accumulate estimated tokens after a chat round. */
export function incrementTurn(chatId: string, inputText: string, outputText: string): void {
  const session = sessions.get(chatId)
  if (!session) return
  session.turnCount++
  session.estimatedTokens += estimateTokens(inputText) + estimateTokens(outputText)
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
  // Write synchronous consciousness entries for active sessions before clearing
  // Use simple sync write (no LLM call) since process may exit immediately after
  // Skip chatIds with pending async insight to avoid duplicate session_end entries
  for (const [chatId, session] of sessions) {
    if (session.turnCount > 0 && !pendingInsights.has(chatId)) {
      try {
        appendEntry({
          ts: new Date().toISOString(),
          type: 'session_end',
          content: `会话结束（进程关闭），${session.turnCount}轮对话`,
          metadata: {
            channel: chatId,
            messageCount: session.turnCount,
            emotionalShift: 'neutral→neutral',
            triggerEvent: '进程关闭',
          },
        })
      } catch {
        // Best-effort — never block shutdown
      }
    }
  }
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

// ── Web chat session management (chat-sessions/ files) ──

const WEB_SESSIONS_DIR = join(DATA_DIR, 'chat-sessions')

export interface WebChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface WebChatSession {
  id: string
  title: string
  messages: WebChatMessage[]
  backend?: string
  createdAt: string
  updatedAt: string
}

export interface WebSessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  backend?: string
  messageCount: number
}

function ensureWebSessionsDir(): void {
  if (!existsSync(WEB_SESSIONS_DIR)) {
    mkdirSync(WEB_SESSIONS_DIR, { recursive: true })
  }
}

function isValidSessionId(id: string): boolean {
  return /^[a-f0-9-]{36}$/.test(id)
}

function getWebSessionPath(id: string): string {
  if (!isValidSessionId(id)) throw new Error('Invalid session ID')
  return join(WEB_SESSIONS_DIR, `${id}.json`)
}

/** Load a web chat session from disk by chatId */
export function loadWebSession(chatId: string): WebChatSession | null {
  if (!isValidSessionId(chatId)) return null
  const path = getWebSessionPath(chatId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/** Save a web chat session to disk */
export function saveWebSession(session: WebChatSession): void {
  ensureWebSessionsDir()
  writeFileSync(getWebSessionPath(session.id), JSON.stringify(session, null, 2))
}

/** Create a new web chat session and register it in the in-memory session map */
export function createWebSession(title?: string, backend?: string): WebChatSession {
  const id = randomUUID()
  const now = new Date().toISOString()
  const session: WebChatSession = {
    id,
    title: title || 'New Chat',
    messages: [],
    backend,
    createdAt: now,
    updatedAt: now,
  }
  saveWebSession(session)
  // Register in the unified ChatSession map so all channels can see it
  sessions.set(id, {
    sessionId: '',
    lastActiveAt: Date.now(),
    turnCount: 0,
    estimatedTokens: 0,
    backendOverride: backend,
    sessionBackendType: backend ?? 'default',
  })
  evictIfNeeded()
  ensureCleanupTimer()
  schedulePersist()
  return session
}

/** Delete a web chat session file and clear from in-memory map */
export function deleteWebSession(chatId: string): boolean {
  if (!isValidSessionId(chatId)) return false
  const path = getWebSessionPath(chatId)
  if (!existsSync(path)) return false
  rmSync(path)
  sessions.delete(chatId)
  schedulePersist()
  return true
}

/** Append a message to a web session, creating the session file if needed.
 *  Truncates oldest messages when exceeding maxWebMessages (keeps first pair + recent). */
export function appendWebMessage(
  chatId: string,
  userMessage: string,
  assistantResponse: string
): void {
  let session = loadWebSession(chatId)
  if (!session) {
    session = {
      id: chatId,
      title: userMessage.slice(0, 50),
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }
  const ts = new Date().toISOString()
  session.messages.push({ role: 'user', content: userMessage, timestamp: ts })
  if (assistantResponse) {
    session.messages.push({ role: 'assistant', content: assistantResponse, timestamp: ts })
  }

  // Truncate old messages when over limit, keeping first 2 (initial context) + recent
  const maxMessages = sessionConfig.maxWebMessages
  if (session.messages.length > maxMessages) {
    const keep = Math.max(maxMessages - 2, 0)
    session.messages = [
      ...session.messages.slice(0, 2),
      ...(keep > 0 ? session.messages.slice(-keep) : []),
    ]
    logger.debug(`Web session ${chatId.slice(0, 8)} truncated to ${session.messages.length} messages`)
  }

  session.updatedAt = ts
  saveWebSession(session)
}

/** List all web session summaries, sorted by updatedAt desc */
export async function listWebSessions(): Promise<WebSessionSummary[]> {
  ensureWebSessionsDir()
  const files = (await readdir(WEB_SESSIONS_DIR)).filter(f => f.endsWith('.json'))
  const results = await Promise.all(
    files.map(async (file) => {
      try {
        const content = await readFileAsync(join(WEB_SESSIONS_DIR, file), 'utf-8')
        return JSON.parse(content) as WebChatSession
      } catch { return null }
    })
  )
  const summaries: WebSessionSummary[] = []
  for (const data of results) {
    if (!data) continue
    summaries.push({
      id: data.id,
      title: data.title,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      backend: data.backend,
      messageCount: data.messages?.length ?? 0,
    })
  }
  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  return summaries
}

/** Check if a string is a valid UUID session ID */
export { isValidSessionId as isValidWebSessionId }
