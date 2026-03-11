import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadInnerState,
  registerSession,
  deregisterSession,
  updateSessionTopic,
  recordEvent,
  formatInnerStateForPrompt,
  _resetForTest,
} from '../innerState.js'
import type { InnerState } from '../innerState.js'

describe('innerState', () => {
  beforeEach(() => {
    _resetForTest()
  })

  describe('loadInnerState', () => {
    it('returns empty default state', () => {
      const state = loadInnerState()
      expect(state.activeSessions).toEqual([])
      expect(state.recentEvents).toEqual([])
      expect(state.updatedAt).toBeTruthy()
    })

    it('returns the same singleton', () => {
      const a = loadInnerState()
      const b = loadInnerState()
      expect(a).toBe(b)
    })
  })

  describe('registerSession', () => {
    it('adds a new session', () => {
      registerSession('s1', 'Lark')
      const state = loadInnerState()
      expect(state.activeSessions).toHaveLength(1)
      expect(state.activeSessions[0]!.sessionId).toBe('s1')
      expect(state.activeSessions[0]!.platform).toBe('Lark')
    })

    it('replaces existing session with same id', () => {
      registerSession('s1', 'Lark')
      registerSession('s1', 'Web')
      const state = loadInnerState()
      expect(state.activeSessions).toHaveLength(1)
      expect(state.activeSessions[0]!.platform).toBe('Web')
    })

    it('supports multiple sessions', () => {
      registerSession('s1', 'Lark')
      registerSession('s2', 'Web')
      expect(loadInnerState().activeSessions).toHaveLength(2)
    })
  })

  describe('deregisterSession', () => {
    it('removes the specified session', () => {
      registerSession('s1', 'Lark')
      registerSession('s2', 'Web')
      deregisterSession('s1')
      const state = loadInnerState()
      expect(state.activeSessions).toHaveLength(1)
      expect(state.activeSessions[0]!.sessionId).toBe('s2')
    })

    it('no-op for non-existent session', () => {
      registerSession('s1', 'Lark')
      deregisterSession('s999')
      expect(loadInnerState().activeSessions).toHaveLength(1)
    })
  })

  describe('updateSessionTopic', () => {
    it('updates topic for existing session', () => {
      registerSession('s1', 'Lark')
      updateSessionTopic('s1', '讨论新功能')
      expect(loadInnerState().activeSessions[0]!.currentTopic).toBe('讨论新功能')
    })

    it('truncates topic to 50 chars', () => {
      registerSession('s1', 'Lark')
      updateSessionTopic('s1', 'a'.repeat(100))
      expect(loadInnerState().activeSessions[0]!.currentTopic).toHaveLength(50)
    })

    it('no-op for non-existent session', () => {
      updateSessionTopic('s999', 'topic')
      expect(loadInnerState().activeSessions).toHaveLength(0)
    })
  })

  describe('recordEvent', () => {
    it('adds an event', () => {
      recordEvent('task_done', '任务完成')
      const events = loadInnerState().recentEvents
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('task_done')
      expect(events[0]!.summary).toBe('任务完成')
      expect(events[0]!.ts).toBeTruthy()
    })

    it('caps at 20 events (sliding window)', () => {
      for (let i = 0; i < 25; i++) {
        recordEvent('task_done', `event-${i}`)
      }
      const events = loadInnerState().recentEvents
      expect(events).toHaveLength(20)
      expect(events[0]!.summary).toBe('event-5')
      expect(events[19]!.summary).toBe('event-24')
    })
  })

  describe('formatInnerStateForPrompt', () => {
    it('returns empty string for empty state', () => {
      const state: InnerState = {
        activeSessions: [],
        recentEvents: [],
        updatedAt: new Date().toISOString(),
      }
      expect(formatInnerStateForPrompt(state)).toBe('')
    })

    it('formats active sessions', () => {
      const state: InnerState = {
        activeSessions: [
          { sessionId: 's1', platform: 'Lark', startedAt: '', currentTopic: '聊天', lastActiveAt: '' },
          { sessionId: 's2', platform: 'Web', startedAt: '', currentTopic: '', lastActiveAt: '' },
        ],
        recentEvents: [],
        updatedAt: '',
      }
      const output = formatInnerStateForPrompt(state)
      expect(output).toContain('当前活跃窗口：2 个')
      expect(output).toContain('Lark: 聊天')
      expect(output).toContain('Web: 新对话')
    })

    it('formats recent events (last 5 only)', () => {
      const events = Array.from({ length: 8 }, (_, i) => ({
        ts: '',
        type: 'task_done' as const,
        summary: `event-${i}`,
      }))
      const state: InnerState = { activeSessions: [], recentEvents: events, updatedAt: '' }
      const output = formatInnerStateForPrompt(state)
      expect(output).toContain('event-3')
      expect(output).toContain('event-7')
      expect(output).not.toContain('event-2')
    })

    it('formats both sessions and events', () => {
      const state: InnerState = {
        activeSessions: [{ sessionId: 's1', platform: 'Lark', startedAt: '', currentTopic: '', lastActiveAt: '' }],
        recentEvents: [{ ts: '', type: 'session_start', summary: '新会话' }],
        updatedAt: '',
      }
      const output = formatInnerStateForPrompt(state)
      expect(output).toContain('当前活跃窗口')
      expect(output).toContain('最近事件')
    })
  })
})
