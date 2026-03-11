/**
 * InnerState — lightweight real-time state for session awareness
 *
 * Tracks active sessions and recent cross-session events.
 * In-memory singleton with debounced file persistence (5s).
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { DATA_DIR } from '../store/paths.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('innerState')

const INNER_STATE_PATH = join(DATA_DIR, 'consciousness', 'inner-state.json')
const MAX_RECENT_EVENTS = 20
const DEBOUNCE_MS = 5000
/** Sessions inactive for this long are considered stale (ghost sessions from crashed daemons) */
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes

// ============ Types ============

export interface ActiveSession {
  sessionId: string
  platform: string
  startedAt: string
  currentTopic: string
  lastActiveAt: string
}

export interface RecentEvent {
  ts: string
  type: 'task_done' | 'task_fail' | 'session_start' | 'session_end' | 'msg_in' | 'msg_out'
  summary: string
}

export interface InnerState {
  activeSessions: ActiveSession[]
  recentEvents: RecentEvent[]
  updatedAt: string
}

// ============ In-memory singleton ============

let cachedState: InnerState | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let dirty = false
let dirCreated = false

function createDefault(): InnerState {
  return { activeSessions: [], recentEvents: [], updatedAt: new Date().toISOString() }
}

function loadFromDisk(): InnerState {
  try {
    const raw = readFileSync(INNER_STATE_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    const now = Date.now()
    // Filter out stale sessions that survived a crashed daemon
    const activeSessions = (parsed.activeSessions ?? []).filter((s: ActiveSession) => {
      const lastActive = s.lastActiveAt ? new Date(s.lastActiveAt).getTime() : new Date(s.startedAt).getTime()
      return now - lastActive < SESSION_TTL_MS
    })
    return {
      activeSessions,
      recentEvents: parsed.recentEvents ?? [],
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    }
  } catch {
    return createDefault()
  }
}

function getState(): InnerState {
  if (!cachedState) {
    cachedState = loadFromDisk()
  }
  return cachedState
}

function markDirty(): void {
  dirty = true
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = null
      persistToDisk()
    }, DEBOUNCE_MS)
  }
}

function persistToDisk(): void {
  if (!dirty || !cachedState) return
  try {
    if (!dirCreated) {
      mkdirSync(dirname(INNER_STATE_PATH), { recursive: true })
      dirCreated = true
    }
    cachedState.updatedAt = new Date().toISOString()
    const tmp = INNER_STATE_PATH + '.tmp'
    writeFileSync(tmp, JSON.stringify(cachedState, null, 2), 'utf-8')
    renameSync(tmp, INNER_STATE_PATH)
    dirty = false
  } catch (error) {
    logger.warn(`Failed to save inner state: ${getErrorMessage(error)}`)
  }
}

// ============ Public API ============

/** Load current inner state (returns in-memory cache, with runtime TTL filtering for stale sessions) */
export function loadInnerState(): InnerState {
  const state = getState()
  // Filter stale sessions at read time (not just on disk load) to evict ghost sessions
  const now = Date.now()
  const filtered = state.activeSessions.filter(s => {
    const lastActive = s.lastActiveAt ? new Date(s.lastActiveAt).getTime() : new Date(s.startedAt).getTime()
    return now - lastActive < SESSION_TTL_MS
  })
  if (filtered.length !== state.activeSessions.length) {
    state.activeSessions = filtered
    markDirty()
  }
  return state
}

/** Flush pending writes immediately (call on shutdown) */
export function flushInnerState(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  persistToDisk()
}

/** @internal Reset singleton state (for testing only) */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function _resetForTest(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  cachedState = createDefault()
  dirty = false
}

/** Clear all active sessions and mark dirty (for daemon shutdown cleanup) */
export function clearActiveSessions(): void {
  const state = getState()
  state.activeSessions = []
  markDirty()
}

// ============ Session Management ============

export function registerSession(sessionId: string, platform: string): void {
  const state = getState()
  const existing = state.activeSessions.findIndex(s => s.sessionId === sessionId)
  const now = new Date().toISOString()
  const session: ActiveSession = {
    sessionId,
    platform,
    startedAt: now,
    currentTopic: '',
    lastActiveAt: now,
  }
  if (existing >= 0) {
    state.activeSessions[existing] = session
  } else {
    state.activeSessions.push(session)
  }
  markDirty()
}

export function deregisterSession(sessionId: string): void {
  const state = getState()
  state.activeSessions = state.activeSessions.filter(s => s.sessionId !== sessionId)
  markDirty()
}

export function updateSessionTopic(sessionId: string, topic: string): void {
  const state = getState()
  const session = state.activeSessions.find(s => s.sessionId === sessionId)
  if (session) {
    session.currentTopic = topic.slice(0, 50)
    session.lastActiveAt = new Date().toISOString()
    markDirty()
  }
}

// ============ Event Recording ============

export function recordEvent(type: RecentEvent['type'], summary: string): void {
  const state = getState()
  state.recentEvents.push({ ts: new Date().toISOString(), type, summary })
  if (state.recentEvents.length > MAX_RECENT_EVENTS) {
    state.recentEvents = state.recentEvents.slice(-MAX_RECENT_EVENTS)
  }
  markDirty()
}

// ============ Prompt Formatting ============

export function formatInnerStateForPrompt(state: InnerState): string {
  const parts: string[] = []

  if (state.activeSessions.length > 0) {
    parts.push(`当前活跃窗口：${state.activeSessions.length} 个`)
    for (const s of state.activeSessions) {
      parts.push(`  - ${s.platform}: ${s.currentTopic || '新对话'}`)
    }
  }

  // Only show meaningful events in prompt — exclude msg_in/msg_out (noise, not actionable context)
  const recent = state.recentEvents
    .filter(e => e.type !== 'msg_in' && e.type !== 'msg_out')
    .slice(-5)
  if (recent.length > 0) {
    parts.push('最近事件：')
    for (const ev of recent) {
      parts.push(`  - ${ev.summary}`)
    }
  }

  return parts.join('\n')
}
