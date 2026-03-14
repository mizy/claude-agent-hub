/**
 * Chat API routes - SSE streaming + session CRUD
 * Delegates session management to sessionManager for unified Lark/Web/CLI access
 */

import type { Express, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { getRegisteredBackends } from '../backend/resolveBackend.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { routeMessage } from '../messaging/handlers/messageRouter.js'
import { cancelActiveChat } from '../messaging/handlers/chatHandler.js'
import { createWebAdapter, WEB_CLIENT_CONTEXT } from '../messaging/webAdapter.js'
import {
  isValidWebSessionId,
  loadWebSession,
  createWebSession,
  deleteWebSession,
  appendWebMessage,
  listWebSessions,
} from '../messaging/handlers/sessionManager.js'

// Re-export types for consumers that imported from chatRoutes
export type {
  WebChatSession,
  WebChatMessage,
  WebSessionSummary,
} from '../messaging/handlers/sessionManager.js'

const logger = createLogger('chat-routes')

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
      res.json(await listWebSessions())
    } catch (err) {
      logger.error('Failed to list sessions', err)
      res.status(500).json({ error: 'Failed to list sessions' })
    }
  })

  // GET /api/chat/sessions/:id - get session detail
  app.get('/api/chat/sessions/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
      if (!isValidWebSessionId(req.params.id)) {
        res.status(400).json({ error: 'Invalid session ID' })
        return
      }
      const session = loadWebSession(req.params.id)
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
      const session = createWebSession(title, backend)
      res.json(session)
    } catch (err) {
      logger.error('Failed to create session', err)
      res.status(500).json({ error: 'Failed to create session' })
    }
  })

  // DELETE /api/chat/sessions/:id - delete session
  app.delete('/api/chat/sessions/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
      if (!isValidWebSessionId(req.params.id)) {
        res.status(400).json({ error: 'Invalid session ID' })
        return
      }
      const deleted = deleteWebSession(req.params.id)
      if (!deleted) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
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

    // Prepend /backend directive so parseBackendOverride picks it up
    const routeText = backend ? `/${backend} ${message}` : message

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

    // Persist messages to web session (unified via sessionManager)
    try {
      appendWebMessage(chatId, message, assistantResponse)
    } catch (err) {
      logger.debug(`Failed to persist chat session: ${getErrorMessage(err)}`)
    }

    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n')
      res.end()
    }
  })
}
