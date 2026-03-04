/**
 * Chat API routes - SSE streaming + session CRUD
 * Sessions stored in ~/.cah-data/chat-sessions/
 */

import type { Express, Request, Response } from 'express'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { readdir, readFile as readFileAsync } from 'fs/promises'
import { DATA_DIR } from '../store/paths.js'
import { getRegisteredBackends } from '../backend/resolveBackend.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { routeMessage } from '../messaging/handlers/messageRouter.js'
import { cancelActiveChat } from '../messaging/handlers/chatHandler.js'
import { createWebAdapter, WEB_CLIENT_CONTEXT } from '../messaging/webAdapter.js'

const logger = createLogger('chat-routes')

const SESSIONS_DIR = join(DATA_DIR, 'chat-sessions')

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  backend?: string
  createdAt: string
  updatedAt: string
}

function ensureSessionsDir() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true })
  }
}

function isValidSessionId(id: string): boolean {
  return /^[a-f0-9-]{36}$/.test(id)
}

function getSessionPath(id: string) {
  if (!isValidSessionId(id)) throw new Error('Invalid session ID')
  return join(SESSIONS_DIR, `${id}.json`)
}

function loadSession(id: string): ChatSession | null {
  if (!isValidSessionId(id)) return null
  const path = getSessionPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function saveSession(session: ChatSession) {
  ensureSessionsDir()
  writeFileSync(getSessionPath(session.id), JSON.stringify(session, null, 2))
}

interface SessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  backend?: string
  messageCount: number
}

async function listSessionSummaries(): Promise<SessionSummary[]> {
  ensureSessionsDir()
  const files = (await readdir(SESSIONS_DIR)).filter(f => f.endsWith('.json'))
  const summaries: SessionSummary[] = []
  const results = await Promise.all(
    files.map(async (file) => {
      try {
        const content = await readFileAsync(join(SESSIONS_DIR, file), 'utf-8')
        return JSON.parse(content) as ChatSession
      } catch { return null }
    })
  )
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

export function registerChatRoutes(app: Express): void {
  // GET /api/backends - available backends
  app.get('/api/backends', (_req: Request, res: Response) => {
    try {
      const backends = getRegisteredBackends()
      res.json(backends)
    } catch (err) {
      logger.error('Failed to get backends', err)
      res.status(500).json({ error: 'Failed to get backends' })
    }
  })

  // GET /api/chat/sessions - list sessions
  app.get('/api/chat/sessions', async (_req: Request, res: Response) => {
    try {
      res.json(await listSessionSummaries())
    } catch (err) {
      logger.error('Failed to list sessions', err)
      res.status(500).json({ error: 'Failed to list sessions' })
    }
  })

  // GET /api/chat/sessions/:id - get session detail
  app.get('/api/chat/sessions/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
      if (!isValidSessionId(req.params.id)) {
        res.status(400).json({ error: 'Invalid session ID' })
        return
      }
      const session = loadSession(req.params.id)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      res.json(session)
    } catch (err) {
      logger.error('Failed to get session', err)
      res.status(500).json({ error: 'Failed to get session' })
    }
  })

  // POST /api/chat/sessions - create session
  app.post('/api/chat/sessions', (req: Request, res: Response) => {
    try {
      const { title, backend } = req.body || {}
      const session: ChatSession = {
        id: randomUUID(),
        title: title || 'New Chat',
        messages: [],
        backend,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      saveSession(session)
      res.json(session)
    } catch (err) {
      logger.error('Failed to create session', err)
      res.status(500).json({ error: 'Failed to create session' })
    }
  })

  // DELETE /api/chat/sessions/:id - delete session
  app.delete('/api/chat/sessions/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
      if (!isValidSessionId(req.params.id)) {
        res.status(400).json({ error: 'Invalid session ID' })
        return
      }
      const path = getSessionPath(req.params.id)
      if (!existsSync(path)) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      rmSync(path)
      res.json({ success: true })
    } catch (err) {
      logger.error('Failed to delete session', err)
      res.status(500).json({ error: 'Failed to delete session' })
    }
  })

  // POST /api/chat - send message (SSE streaming via routeMessage)
  app.post('/api/chat', async (req: Request, res: Response) => {
    const { message, sessionId, backend } = req.body || {}

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' })
      return
    }

    if (message.length > 100_000) {
      res.status(400).json({ error: 'message too long' })
      return
    }

    // Prepend @backend directive so parseBackendOverride picks it up
    const routeText = backend ? `@${backend} ${message}` : message

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const chatId = sessionId || randomUUID()

    // Abort backend call when client disconnects
    let clientDisconnected = false
    req.on('close', () => {
      clientDisconnected = true
      cancelActiveChat(chatId)
    })

    // Send sessionId first
    res.write(`data: ${JSON.stringify({ sessionId: chatId })}\n\n`)

    let assistantResponse = ''
    try {
      const adapter = createWebAdapter(res)
      await routeMessage({
        chatId,
        text: routeText,
        messenger: adapter.messenger,
        clientContext: WEB_CLIENT_CONTEXT,
      })
      assistantResponse = adapter.getLastResponse()
    } catch (err) {
      if (clientDisconnected) {
        logger.debug('Chat SSE aborted by client disconnect')
        return
      }
      logger.error('Chat invoke failed', err)
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: getErrorMessage(err) })}\n\n`)
      }
    }

    // Persist messages to session
    try {
      let session = loadSession(chatId)
      if (!session) {
        session = {
          id: chatId,
          title: message.slice(0, 50),
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      }
      session.messages.push({ role: 'user', content: message, timestamp: new Date().toISOString() })
      if (assistantResponse) {
        session.messages.push({ role: 'assistant', content: assistantResponse, timestamp: new Date().toISOString() })
      }
      session.updatedAt = new Date().toISOString()
      saveSession(session)
    } catch (err) {
      logger.debug(`Failed to persist chat session: ${getErrorMessage(err)}`)
    }

    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n')
      res.end()
    }
  })
}
