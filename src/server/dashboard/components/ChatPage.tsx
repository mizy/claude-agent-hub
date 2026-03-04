import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { fetchApi, postApi, deleteApi } from '../api/fetchApi'

let msgIdCounter = 0
const genMsgId = () => `client-msg-${++msgIdCounter}-${Date.now()}`

const AssistantIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
  </svg>
)

interface ChatMessage {
  id: string
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

function createMsg(role: ChatMessage['role'], content: string): ChatMessage {
  return { id: genMsgId(), role, content, timestamp: new Date().toISOString() }
}

const QP_ICONS: Record<string, JSX.Element> = {
  analyze: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  status: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  suggest: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14"/></svg>,
  create: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
}

const QUICK_PROMPTS = [
  { iconKey: 'analyze', label: 'Analyze a task', prompt: 'Analyze my latest completed task and summarize the results' },
  { iconKey: 'status', label: 'System status', prompt: 'What is the current system status? Show task statistics' },
  { iconKey: 'suggest', label: 'Suggest improvements', prompt: 'Suggest improvements for my recent workflow' },
  { iconKey: 'create', label: 'Create a task', prompt: 'Help me create a new task for ' },
]

function groupSessionsByDate(sessions: SessionSummary[]): { label: string; items: SessionSummary[] }[] {
  const now = new Date()
  const today = now.toDateString()
  const yesterday = new Date(now.getTime() - 86400000).toDateString()
  const groups: { label: string; items: SessionSummary[] }[] = []
  const map = new Map<string, SessionSummary[]>()

  for (const s of sessions) {
    const d = new Date(s.updatedAt).toDateString()
    const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : 'Earlier'
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(s)
  }
  for (const label of ['Today', 'Yesterday', 'Earlier']) {
    const items = map.get(label)
    if (items?.length) groups.push({ label, items })
  }
  return groups
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

  // Scroll to bottom — instant during streaming to avoid queued smooth scrolls
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: streaming ? 'instant' : 'smooth' })
  }, [messages, streamingContent, streaming])

  const selectSession = async (id: string) => {
    setActiveSessionId(id)
    const detail = await fetchApi<SessionDetail>(`/api/chat/sessions/${id}`)
    if (detail) {
      setMessages(detail.messages.map(m => ({ ...m, id: m.id || genMsgId() })))
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

    const userMsg = createMsg('user', trimmed)
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
          } catch (parseErr) {
            if (import.meta.env.DEV) console.warn('SSE JSON parse failed:', data, parseErr)
          }
        }
      }

      // Finalize: add assistant message
      if (accumulated) {
        const assistantMsg = createMsg('assistant', accumulated)
        setMessages(prev => [...prev, assistantMsg])
      }
      setStreamingContent('')
      loadSessions()
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const errorMsg = createMsg('assistant', `[Error: ${(err as Error).message}]`)
        setMessages(prev => [...prev, errorMsg])
        setStreamingContent('')
      } else {
        // Aborted: finalize partial content
        if (accumulated) {
          setMessages(prev => [...prev, createMsg('assistant', accumulated + '\n[Stopped]')])
          setStreamingContent('')
        }
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [input, streaming, activeSessionId, selectedBackend, loadSessions])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const activeSession = useMemo(() => sessions.find(s => s.id === activeSessionId), [sessions, activeSessionId])

  const renderMarkdown = useCallback((content: string) => {
    const raw = marked.parse(content, { async: false }) as string
    return { __html: DOMPurify.sanitize(raw) }
  }, [])

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
          {groupSessionsByDate(sessions).map(group => (
            <div key={group.label} className="chat-session-group">
              <div className="chat-session-group-label">{group.label}</div>
              {group.items.map(s => (
                <div
                  key={s.id}
                  className={`chat-session-item ${activeSessionId === s.id ? 'active' : ''}`}
                  onClick={() => selectSession(s.id)}
                >
                  <div className="chat-session-top">
                    <div className="chat-session-title">{s.title}</div>
                    <button
                      className="chat-session-delete"
                      onClick={(e) => deleteSession(s.id, e)}
                      title="Delete session"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2L10 10M10 2L2 10"/></svg>
                    </button>
                  </div>
                  <div className="chat-session-meta">
                    <span>{formatTime(s.updatedAt)}</span>
                    <span>·</span>
                    <span>{s.messageCount} msgs</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="chat-empty-sessions">
              <svg className="chat-empty-sessions-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <div>No conversations yet</div>
              <div className="chat-empty-sessions-hint">Start a new chat to begin</div>
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="chat-main">
        <div className="chat-main-header">
          <span className="chat-main-title">
            {activeSessionId ? activeSession?.title || 'Chat' : 'New Chat'}
          </span>
          <select
            className="chat-backend-select"
            value={selectedBackend}
            onChange={e => setSelectedBackend(e.target.value)}
          >
            <option value="">Default Backend</option>
            {backends.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        <div className="chat-messages">
          {messages.length === 0 && !streaming && (
            <div className="chat-empty-state">
              <div className="chat-empty-logo">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div className="chat-empty-title">How can I help you?</div>
              <div className="chat-empty-hint">Ask me anything or try a quick prompt below</div>
              <div className="chat-quick-prompts">
                {QUICK_PROMPTS.map((qp, i) => (
                  <button
                    key={i}
                    className="chat-quick-prompt"
                    onClick={() => { setInput(qp.prompt); inputRef.current?.focus() }}
                  >
                    <span className="chat-qp-icon">{QP_ICONS[qp.iconKey]}</span>
                    <span className="chat-qp-label">{qp.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-bubble ${msg.role}`}>
              <div className="chat-bubble-row">
                <div className={`chat-avatar ${msg.role}`}>
                  {msg.role === 'user' ? 'U' : <AssistantIcon />}
                </div>
                <div className="chat-bubble-body">
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
              </div>
            </div>
          ))}
          {streaming && (
            <div className="chat-bubble assistant">
              <div className="chat-bubble-row">
                <div className="chat-avatar assistant"><AssistantIcon /></div>
                <div className="chat-bubble-body">
                  {streamingContent ? (
                    <>
                      <div className="chat-bubble-content markdown-body" dangerouslySetInnerHTML={renderMarkdown(streamingContent)} />
                      <div className="chat-bubble-time streaming-indicator">Generating...</div>
                    </>
                  ) : (
                    <div className="typing-dots"><span /><span /><span /></div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <div className="chat-input-row">
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything... (Enter to send)"
              rows={1}
              disabled={streaming}
            />
            {streaming ? (
              <button className="chat-send-btn stop" onClick={stopGeneration} title="Stop generating">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2" width="10" height="10" rx="1.5"/></svg>
              </button>
            ) : (
              <button className="chat-send-btn" onClick={sendMessage} disabled={!input.trim()} title="Send message">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2L7 9"/><path d="M14 2L9.5 14L7 9L2 6.5L14 2Z"/></svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
