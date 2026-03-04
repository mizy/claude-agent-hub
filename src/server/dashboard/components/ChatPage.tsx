import { useState, useEffect, useRef, useCallback } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { fetchApi, postApi, deleteApi } from '../api/fetchApi'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

interface SessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  backend?: string
  messageCount: number
}

interface SessionDetail {
  id: string
  title: string
  messages: ChatMessage[]
  backend?: string
  createdAt: string
  updatedAt: string
}

export function ChatPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [backends, setBackends] = useState<string[]>([])
  const [selectedBackend, setSelectedBackend] = useState<string>('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const loadSessions = useCallback(async () => {
    const data = await fetchApi<SessionSummary[]>('/api/chat/sessions')
    if (data) setSessions(data)
  }, [])

  const loadBackends = useCallback(async () => {
    const data = await fetchApi<string[]>('/api/backends')
    if (data) setBackends(data)
  }, [])

  // Load sessions and backends on mount
  useEffect(() => {
    loadSessions()
    loadBackends()
  }, [loadSessions, loadBackends])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const selectSession = async (id: string) => {
    setActiveSessionId(id)
    const detail = await fetchApi<SessionDetail>(`/api/chat/sessions/${id}`)
    if (detail) {
      setMessages(detail.messages)
      if (detail.backend) setSelectedBackend(detail.backend)
    }
  }

  const createNewSession = () => {
    setActiveSessionId(null)
    setMessages([])
    setInput('')
    setStreamingContent('')
    inputRef.current?.focus()
  }

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteApi(`/api/chat/sessions/${id}`)
    if (activeSessionId === id) {
      setActiveSessionId(null)
      setMessages([])
    }
    loadSessions()
  }

  const stopGeneration = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || streaming) return

    const userMsg: ChatMessage = { role: 'user', content: trimmed, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStreaming(true)
    setStreamingContent('')

    const controller = new AbortController()
    abortRef.current = controller
    let accumulated = ''

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          sessionId: activeSessionId,
          backend: selectedBackend || undefined,
        }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let sessionCreated = false
      let sseBuffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        sseBuffer += decoder.decode(value, { stream: true })
        const parts = sseBuffer.split('\n')
        sseBuffer = parts.pop() || '' // keep incomplete tail for next chunk

        for (const line of parts) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)

          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            if (parsed.sessionId && !sessionCreated) {
              setActiveSessionId(parsed.sessionId)
              sessionCreated = true
            }
            if (parsed.content) {
              if (parsed.replace) {
                accumulated = parsed.content
              } else {
                accumulated += parsed.content
              }
              setStreamingContent(accumulated)
            }
            if (parsed.error) {
              accumulated += `\n[Error: ${parsed.error}]`
              setStreamingContent(accumulated)
            }
          } catch { /* skip malformed */ }
        }
      }

      // Finalize: add assistant message
      if (accumulated) {
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: accumulated,
          timestamp: new Date().toISOString(),
        }
        setMessages(prev => [...prev, assistantMsg])
      }
      setStreamingContent('')
      loadSessions()
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const errorMsg: ChatMessage = {
          role: 'assistant',
          content: `[Error: ${(err as Error).message}]`,
          timestamp: new Date().toISOString(),
        }
        setMessages(prev => [...prev, errorMsg])
        setStreamingContent('')
      } else {
        // Aborted: finalize partial content
        if (accumulated) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: accumulated + '\n[Stopped]',
            timestamp: new Date().toISOString(),
          }])
          setStreamingContent('')
        }
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [input, streaming, activeSessionId, selectedBackend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const renderMarkdown = (content: string) => {
    const raw = marked.parse(content, { async: false }) as string
    return { __html: DOMPurify.sanitize(raw) }
  }

  const formatTime = (ts: string) => {
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <div className="chat-page">
      {/* Session List */}
      <div className="chat-sessions">
        <div className="chat-sessions-header">
          <span>Sessions</span>
          <button className="chat-new-btn" onClick={createNewSession} title="New Chat">+</button>
        </div>
        <div className="chat-sessions-list">
          {sessions.map(s => (
            <div
              key={s.id}
              className={`chat-session-item ${activeSessionId === s.id ? 'active' : ''}`}
              onClick={() => selectSession(s.id)}
            >
              <div className="chat-session-title">{s.title}</div>
              <div className="chat-session-meta">
                <span>{formatTime(s.updatedAt)}</span>
                <span>{s.messageCount} msgs</span>
                <button
                  className="chat-session-delete"
                  onClick={(e) => deleteSession(s.id, e)}
                  title="Delete"
                >x</button>
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="chat-empty-sessions">No sessions yet</div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="chat-main">
        <div className="chat-messages">
          {messages.map((msg) => (
            <div key={`${msg.timestamp}-${msg.role}`} className={`chat-bubble ${msg.role}`}>
              {msg.role === 'user' ? (
                <div className="chat-bubble-content user-content">{msg.content}</div>
              ) : (
                <div
                  className="chat-bubble-content markdown-body"
                  dangerouslySetInnerHTML={renderMarkdown(msg.content)}
                />
              )}
              <div className="chat-bubble-time">{formatTime(msg.timestamp)}</div>
            </div>
          ))}
          {streaming && streamingContent && (
            <div className="chat-bubble assistant">
              <div
                className="chat-bubble-content markdown-body"
                dangerouslySetInnerHTML={renderMarkdown(streamingContent)}
              />
              <div className="chat-bubble-time streaming-indicator">Generating...</div>
            </div>
          )}
          {streaming && !streamingContent && (
            <div className="chat-bubble assistant">
              <div className="chat-bubble-content typing-dots">
                <span /><span /><span />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <div className="chat-input-row">
            <select
              className="chat-backend-select"
              value={selectedBackend}
              onChange={e => setSelectedBackend(e.target.value)}
            >
              <option value="">Default</option>
              {backends.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
              rows={1}
              disabled={streaming}
            />
            {streaming ? (
              <button className="chat-send-btn stop" onClick={stopGeneration}>Stop</button>
            ) : (
              <button className="chat-send-btn" onClick={sendMessage} disabled={!input.trim()}>Send</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
