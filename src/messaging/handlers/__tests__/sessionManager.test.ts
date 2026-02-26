import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock dependencies before importing module
vi.mock('../../../store/readWriteJson.js', () => ({
  readJson: vi.fn(),
  writeJson: vi.fn(),
}))
vi.mock('../../../store/paths.js', () => ({ DATA_DIR: '/tmp/test-cah' }))

import {
  configureSession,
  loadSessions,
  getSession,
  setSession,
  clearSession,
  setModelOverride,
  getModelOverride,
  setBackendOverride,
  getBackendOverride,
  incrementTurn,
  enqueueChat,
  getSessionCount,
  destroySessions,
} from '../sessionManager.js'
import { readJson } from '../../../store/readWriteJson.js'

beforeEach(() => {
  destroySessions()
  vi.clearAllMocks()
  // Reset to default config
  configureSession({
    timeoutMinutes: 60,
    maxTurns: 10,
    maxEstimatedTokens: 50_000,
    maxSessions: 200,
  })
})

describe('sessionManager', () => {
  describe('session CRUD', () => {
    it('should create and retrieve a session', () => {
      setSession('chat-1', 'sess-1', 'claude-code')
      const s = getSession('chat-1')
      expect(s).toBeDefined()
      expect(s!.sessionId).toBe('sess-1')
      expect(s!.sessionBackendType).toBe('claude-code')
      expect(s!.turnCount).toBe(0)
      expect(s!.estimatedTokens).toBe(0)
    })

    it('should return undefined for non-existent session', () => {
      expect(getSession('no-such')).toBeUndefined()
    })

    it('should clear a session', () => {
      setSession('chat-1', 'sess-1')
      expect(clearSession('chat-1')).toBe(true)
      expect(getSession('chat-1')).toBeUndefined()
    })

    it('should return false when clearing non-existent session', () => {
      expect(clearSession('no-such')).toBe(false)
    })

    it('should track session count', () => {
      expect(getSessionCount()).toBe(0)
      setSession('a', 's1')
      setSession('b', 's2')
      expect(getSessionCount()).toBe(2)
      clearSession('a')
      expect(getSessionCount()).toBe(1)
    })
  })

  describe('overrides', () => {
    it('should set and get model override on existing session', () => {
      setSession('chat-1', 'sess-1')
      setModelOverride('chat-1', 'opus')
      expect(getModelOverride('chat-1')).toBe('opus')
    })

    it('should create placeholder session for model override if none exists', () => {
      setModelOverride('chat-new', 'haiku')
      expect(getModelOverride('chat-new')).toBe('haiku')
      expect(getSession('chat-new')).toBeDefined()
      expect(getSession('chat-new')!.sessionId).toBe('')
    })

    it('should set and get backend override', () => {
      setSession('chat-1', 'sess-1')
      setBackendOverride('chat-1', 'iflow')
      expect(getBackendOverride('chat-1')).toBe('iflow')
    })

    it('should create placeholder session for backend override if none exists', () => {
      setBackendOverride('chat-new', 'opencode')
      expect(getBackendOverride('chat-new')).toBe('opencode')
    })

    it('should clear override when set to undefined', () => {
      setSession('chat-1', 'sess-1')
      setModelOverride('chat-1', 'opus')
      setModelOverride('chat-1', undefined)
      expect(getModelOverride('chat-1')).toBeUndefined()
    })

    it('should preserve overrides when creating new session', () => {
      setSession('chat-1', 'sess-1')
      setModelOverride('chat-1', 'opus')
      setBackendOverride('chat-1', 'iflow')
      // Re-create session (e.g. backend switch)
      setSession('chat-1', 'sess-2')
      // modelOverride and backendOverride are carried from existing session
      expect(getModelOverride('chat-1')).toBe('opus')
      expect(getBackendOverride('chat-1')).toBe('iflow')
    })

    it('should preserve turn counters when resuming same session', () => {
      setSession('chat-1', 'sess-1')
      incrementTurn('chat-1', 100, 200)
      incrementTurn('chat-1', 100, 200)
      const before = getSession('chat-1')!
      expect(before.turnCount).toBe(2)

      // Re-set with same sessionId (happens on every chat turn in chatHandler)
      setSession('chat-1', 'sess-1')
      const after = getSession('chat-1')!
      expect(after.turnCount).toBe(2)
      expect(after.estimatedTokens).toBe(before.estimatedTokens)
    })

    it('should reset turn counters when session ID changes', () => {
      setSession('chat-1', 'sess-1')
      incrementTurn('chat-1', 100, 200)
      incrementTurn('chat-1', 100, 200)
      expect(getSession('chat-1')!.turnCount).toBe(2)

      // New session ID (e.g. backend switch or manual reset)
      setSession('chat-1', 'sess-2')
      expect(getSession('chat-1')!.turnCount).toBe(0)
      expect(getSession('chat-1')!.estimatedTokens).toBe(0)
    })
  })

  describe('turn counting', () => {
    it('should increment turn count and tokens', () => {
      setSession('chat-1', 'sess-1')
      incrementTurn('chat-1', 100, 200)
      const s = getSession('chat-1')
      expect(s!.turnCount).toBe(1)
      expect(s!.estimatedTokens).toBeGreaterThan(0)
    })

    it('should be no-op for non-existent session', () => {
      // Should not throw
      incrementTurn('no-such', 100, 100)
      expect(getSession('no-such')).toBeUndefined()
    })
  })

  describe('LRU eviction', () => {
    it('should evict oldest sessions when over maxSessions', () => {
      configureSession({ timeoutMinutes: 60, maxTurns: 10, maxEstimatedTokens: 50_000, maxSessions: 3 })

      setSession('a', 's1')
      setSession('b', 's2')
      setSession('c', 's3')
      expect(getSessionCount()).toBe(3)

      // Adding a 4th should evict the oldest
      setSession('d', 's4')
      expect(getSessionCount()).toBe(3)
      // 'a' was oldest, should be evicted
      expect(getSession('a')).toBeUndefined()
      expect(getSession('d')).toBeDefined()
    })
  })

  describe('loadSessions', () => {
    it('should restore sessions from disk', () => {
      vi.mocked(readJson).mockReturnValue({
        'chat-1': { sessionId: 'sess-1', lastActiveAt: Date.now() - 1000, turnCount: 2, estimatedTokens: 100 },
      })
      loadSessions()
      expect(getSession('chat-1')).toBeDefined()
      expect(getSession('chat-1')!.turnCount).toBe(2)
    })

    it('should skip expired sessions on load', () => {
      vi.mocked(readJson).mockReturnValue({
        'chat-old': { sessionId: 'sess-old', lastActiveAt: Date.now() - 999_999_999, turnCount: 0, estimatedTokens: 0 },
      })
      loadSessions()
      expect(getSession('chat-old')).toBeUndefined()
    })

    it('should handle missing file gracefully', () => {
      vi.mocked(readJson).mockReturnValue(null)
      loadSessions()
      expect(getSessionCount()).toBe(0)
    })

    it('should backfill turnCount/estimatedTokens for old sessions', () => {
      vi.mocked(readJson).mockReturnValue({
        'chat-1': { sessionId: 'sess-1', lastActiveAt: Date.now() - 1000 } as Record<string, unknown>,
      })
      loadSessions()
      const s = getSession('chat-1')
      expect(s!.turnCount).toBe(0)
      expect(s!.estimatedTokens).toBe(0)
    })
  })

  describe('enqueueChat', () => {
    it('should serialize tasks for the same chatId', async () => {
      const order: number[] = []
      const p1 = enqueueChat('chat-1', async () => {
        await new Promise((r) => setTimeout(r, 50))
        order.push(1)
      })
      const p2 = enqueueChat('chat-1', async () => {
        order.push(2)
      })
      await Promise.all([p1, p2])
      expect(order).toEqual([1, 2])
    })

    it('should not block next message on error', async () => {
      const order: number[] = []
      const p1 = enqueueChat('chat-1', async () => {
        throw new Error('fail')
      }).catch(() => { order.push(-1) })
      const p2 = enqueueChat('chat-1', async () => {
        order.push(2)
      })
      await Promise.all([p1, p2])
      expect(order).toEqual([-1, 2])
    })

    it('should allow parallel execution for different chatIds', async () => {
      let concurrent = 0
      let maxConcurrent = 0
      const task = async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise((r) => setTimeout(r, 30))
        concurrent--
      }
      await Promise.all([
        enqueueChat('a', task),
        enqueueChat('b', task),
      ])
      expect(maxConcurrent).toBe(2)
    })
  })

  describe('destroySessions', () => {
    it('should clear all sessions', () => {
      setSession('a', 's1')
      setSession('b', 's2')
      destroySessions()
      expect(getSessionCount()).toBe(0)
    })
  })
})
