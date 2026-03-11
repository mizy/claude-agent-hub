/**
 * Web chat session management (chat-sessions/ files)
 * Extracted from sessionManager.ts to keep file size under 500 lines.
 */

import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { readdir, readFile as readFileAsync } from 'fs/promises'
import { randomUUID } from 'crypto'
import { createLogger } from '../../shared/logger.js'
import { DATA_DIR } from '../../store/paths.js'

const logger = createLogger('web-session')

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

/** Create a new web chat session. Returns session data; caller registers in session map. */
export function createWebSessionFile(title?: string, backend?: string): WebChatSession {
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
  return session
}

/** Delete a web chat session file */
export function deleteWebSessionFile(chatId: string): boolean {
  if (!isValidSessionId(chatId)) return false
  const path = getWebSessionPath(chatId)
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

/** Append a message to a web session, creating the session file if needed.
 *  Truncates oldest messages when exceeding maxMessages (keeps first pair + recent). */
export function appendWebMessage(
  chatId: string,
  userMessage: string,
  assistantResponse: string,
  maxMessages: number,
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

export { isValidSessionId as isValidWebSessionId }
