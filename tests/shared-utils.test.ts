/**
 * Shared 工具函数测试
 *
 * 覆盖:
 * - formatTime: formatDuration, parseInterval, intervalToCron
 * - generateId: generateId, generateShortId, isValidUUID, shortenId, matchesShortId
 * - nodeStatus: 状态判断辅助函数
 * - task types: parseTaskPriority, parseTaskStatus
 */

import { describe, it, expect } from 'vitest'

// ============ formatTime ============

import {
  now,
  formatTime,
  formatDuration,
  parseInterval,
  intervalToCron,
  timeDiff,
} from '../src/shared/formatTime.js'

describe('formatTime utilities', () => {
  describe('now()', () => {
    it('should return ISO string', () => {
      const result = now()
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      // Should be parseable
      expect(new Date(result).getTime()).toBeGreaterThan(0)
    })
  })

  describe('formatTime()', () => {
    it('should format ISO string to default pattern', () => {
      const result = formatTime('2025-01-15T10:30:00.000Z')
      expect(result).toMatch(/2025-01-15/)
    })

    it('should support custom pattern', () => {
      const result = formatTime('2025-06-01T00:00:00.000Z', 'yyyy/MM/dd')
      expect(result).toBe('2025/06/01')
    })
  })

  describe('timeDiff()', () => {
    it('should calculate millisecond difference', () => {
      const start = '2025-01-01T00:00:00.000Z'
      const end = '2025-01-01T00:01:00.000Z'
      expect(timeDiff(start, end)).toBe(60000) // 1 minute
    })

    it('should return negative for reverse order', () => {
      const start = '2025-01-01T00:01:00.000Z'
      const end = '2025-01-01T00:00:00.000Z'
      expect(timeDiff(start, end)).toBe(-60000)
    })
  })

  describe('formatDuration()', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms')
    })

    it('should format seconds', () => {
      expect(formatDuration(3500)).toBe('3.5s')
    })

    it('should format minutes and seconds', () => {
      expect(formatDuration(90000)).toBe('1m 30s')
    })

    it('should format hours and minutes', () => {
      expect(formatDuration(5400000)).toBe('1h 30m')
    })

    it('should handle zero', () => {
      expect(formatDuration(0)).toBe('0ms')
    })

    it('should handle exact boundaries', () => {
      expect(formatDuration(1000)).toBe('1.0s')
      expect(formatDuration(60000)).toBe('1m 0s')
      expect(formatDuration(3600000)).toBe('1h 0m')
    })
  })

  describe('parseInterval()', () => {
    it('should parse seconds', () => {
      expect(parseInterval('30s')).toBe(30000)
    })

    it('should parse minutes', () => {
      expect(parseInterval('5m')).toBe(300000)
    })

    it('should parse hours', () => {
      expect(parseInterval('2h')).toBe(7200000)
    })

    it('should parse days', () => {
      expect(parseInterval('1d')).toBe(86400000)
    })

    it('should throw on invalid format', () => {
      expect(() => parseInterval('invalid')).toThrow('Invalid interval format')
      expect(() => parseInterval('5x')).toThrow('Invalid interval format')
      expect(() => parseInterval('')).toThrow('Invalid interval format')
    })
  })

  describe('intervalToCron()', () => {
    it('should convert minutes to cron', () => {
      expect(intervalToCron('5m')).toBe('*/5 * * * *')
      expect(intervalToCron('30m')).toBe('*/30 * * * *')
    })

    it('should convert hours to cron', () => {
      expect(intervalToCron('2h')).toBe('0 */2 * * *')
    })

    it('should convert days to cron', () => {
      expect(intervalToCron('1d')).toBe('0 0 */1 * *')
    })

    it('should throw on invalid format', () => {
      expect(() => intervalToCron('invalid')).toThrow('Invalid interval format')
    })

    it('should throw on seconds (not supported for cron)', () => {
      expect(() => intervalToCron('30s')).toThrow('Invalid interval format')
    })
  })
})

// ============ generateId ============

import {
  generateId,
  generateShortId,
  isValidUUID,
  shortenId,
  matchesShortId,
} from '../src/shared/generateId.js'

describe('generateId utilities', () => {
  describe('generateId()', () => {
    it('should return a valid UUID', () => {
      const id = generateId()
      expect(isValidUUID(id)).toBe(true)
    })

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()))
      expect(ids.size).toBe(100)
    })
  })

  describe('generateShortId()', () => {
    it('should return 8 characters', () => {
      const id = generateShortId()
      expect(id).toHaveLength(8)
    })

    it('should only contain hex characters', () => {
      const id = generateShortId()
      expect(id).toMatch(/^[0-9a-f]{8}$/)
    })
  })

  describe('isValidUUID()', () => {
    it('should validate correct UUIDs', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
      expect(isValidUUID('00000000-0000-0000-0000-000000000000')).toBe(true)
    })

    it('should reject invalid UUIDs', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false)
      expect(isValidUUID('')).toBe(false)
      expect(isValidUUID('550e8400')).toBe(false)
      expect(isValidUUID('550e8400-e29b-41d4-a716-44665544000g')).toBe(false) // 'g' invalid
    })
  })

  describe('shortenId()', () => {
    it('should shorten to 8 chars by default', () => {
      expect(shortenId('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400')
    })

    it('should support custom length', () => {
      expect(shortenId('550e8400-e29b-41d4', 4)).toBe('550e')
    })
  })

  describe('matchesShortId()', () => {
    it('should match prefix', () => {
      expect(matchesShortId('550e8400-e29b-41d4-a716-446655440000', '550e8400')).toBe(true)
      expect(matchesShortId('550e8400-e29b-41d4-a716-446655440000', '550e')).toBe(true)
    })

    it('should be case-insensitive', () => {
      expect(matchesShortId('550e8400-e29b-41d4', '550E84')).toBe(true)
    })

    it('should reject non-matching prefix', () => {
      expect(matchesShortId('550e8400-e29b-41d4', 'abcdef')).toBe(false)
    })
  })
})

// ============ nodeStatus helpers ============

import {
  isNodeDone,
  isNodeRunning,
  isNodeFailed,
  isNodeWaiting,
  isNodeSkipped,
  isWorkflowTerminal,
  isWorkflowRunning,
  isWorkflowCompleted,
  isWorkflowFailed,
  isWorkflowPaused,
} from '../src/types/nodeStatus.js'

describe('nodeStatus helpers', () => {
  describe('isNodeDone()', () => {
    it('should return true for done and skipped', () => {
      expect(isNodeDone('done')).toBe(true)
      expect(isNodeDone('skipped')).toBe(true)
    })

    it('should return false for other statuses', () => {
      expect(isNodeDone('pending')).toBe(false)
      expect(isNodeDone('running')).toBe(false)
      expect(isNodeDone('failed')).toBe(false)
      expect(isNodeDone('ready')).toBe(false)
      expect(isNodeDone('waiting')).toBe(false)
    })
  })

  describe('isNodeRunning()', () => {
    it('should return true only for running', () => {
      expect(isNodeRunning('running')).toBe(true)
      expect(isNodeRunning('pending')).toBe(false)
      expect(isNodeRunning('done')).toBe(false)
    })
  })

  describe('isNodeFailed()', () => {
    it('should return true only for failed', () => {
      expect(isNodeFailed('failed')).toBe(true)
      expect(isNodeFailed('done')).toBe(false)
    })
  })

  describe('isNodeWaiting()', () => {
    it('should return true for pending and ready', () => {
      expect(isNodeWaiting('pending')).toBe(true)
      expect(isNodeWaiting('ready')).toBe(true)
      expect(isNodeWaiting('running')).toBe(false)
    })
  })

  describe('isNodeSkipped()', () => {
    it('should return true only for skipped', () => {
      expect(isNodeSkipped('skipped')).toBe(true)
      expect(isNodeSkipped('done')).toBe(false)
    })
  })
})

describe('workflowStatus helpers', () => {
  describe('isWorkflowTerminal()', () => {
    it('should return true for terminal statuses', () => {
      expect(isWorkflowTerminal('completed')).toBe(true)
      expect(isWorkflowTerminal('failed')).toBe(true)
      expect(isWorkflowTerminal('cancelled')).toBe(true)
    })

    it('should return false for non-terminal statuses', () => {
      expect(isWorkflowTerminal('pending')).toBe(false)
      expect(isWorkflowTerminal('running')).toBe(false)
      expect(isWorkflowTerminal('paused')).toBe(false)
    })
  })

  describe('isWorkflowRunning()', () => {
    it('should work correctly', () => {
      expect(isWorkflowRunning('running')).toBe(true)
      expect(isWorkflowRunning('pending')).toBe(false)
    })
  })

  describe('isWorkflowCompleted()', () => {
    it('should work correctly', () => {
      expect(isWorkflowCompleted('completed')).toBe(true)
      expect(isWorkflowCompleted('failed')).toBe(false)
    })
  })

  describe('isWorkflowFailed()', () => {
    it('should work correctly', () => {
      expect(isWorkflowFailed('failed')).toBe(true)
      expect(isWorkflowFailed('completed')).toBe(false)
    })
  })

  describe('isWorkflowPaused()', () => {
    it('should work correctly', () => {
      expect(isWorkflowPaused('paused')).toBe(true)
      expect(isWorkflowPaused('running')).toBe(false)
    })
  })
})

// ============ task type parsers ============

import { parseTaskPriority, parseTaskStatus } from '../src/types/task.js'

describe('task type parsers', () => {
  describe('parseTaskPriority()', () => {
    it('should parse valid priorities', () => {
      expect(parseTaskPriority('low')).toBe('low')
      expect(parseTaskPriority('medium')).toBe('medium')
      expect(parseTaskPriority('high')).toBe('high')
    })

    it('should default to medium for invalid values', () => {
      expect(parseTaskPriority('invalid')).toBe('medium')
      expect(parseTaskPriority(undefined)).toBe('medium')
      expect(parseTaskPriority('')).toBe('medium')
    })
  })

  describe('parseTaskStatus()', () => {
    it('should parse valid statuses', () => {
      expect(parseTaskStatus('pending')).toBe('pending')
      expect(parseTaskStatus('planning')).toBe('planning')
      expect(parseTaskStatus('developing')).toBe('developing')
      expect(parseTaskStatus('reviewing')).toBe('reviewing')
      expect(parseTaskStatus('completed')).toBe('completed')
      expect(parseTaskStatus('failed')).toBe('failed')
      expect(parseTaskStatus('cancelled')).toBe('cancelled')
    })

    it('should return null for invalid statuses', () => {
      expect(parseTaskStatus('invalid')).toBeNull()
      expect(parseTaskStatus(undefined)).toBeNull()
      expect(parseTaskStatus('')).toBeNull()
    })
  })
})
