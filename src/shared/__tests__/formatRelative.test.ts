import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formatRelative } from '../formatters/formatRelative.js'

const FIXED_NOW = new Date('2026-03-05T12:00:00.000Z')

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('locale=zh (default)', () => {
    // date-fns formatDistanceToNow without includeSeconds rounds <45s to "less than a minute"
    it('formats short durations in Chinese (不到 1 分钟)', () => {
      const ts = new Date(FIXED_NOW.getTime() - 30 * 1000).toISOString()
      const result = formatRelative(ts)
      // Should contain Chinese text (either 分钟 or 不到)
      expect(result).toMatch(/[\u4e00-\u9fff]/)
    })

    it('formats minutes ago in Chinese', () => {
      const ts = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000).toISOString()
      expect(formatRelative(ts)).toMatch(/分钟/)
    })

    it('formats hours ago in Chinese', () => {
      const ts = new Date(FIXED_NOW.getTime() - 3 * 3600 * 1000).toISOString()
      expect(formatRelative(ts)).toMatch(/小时/)
    })

    it('formats days ago in Chinese', () => {
      const ts = new Date(FIXED_NOW.getTime() - 2 * 86400 * 1000).toISOString()
      expect(formatRelative(ts)).toMatch(/天/)
    })

    it('explicit locale=zh produces same output', () => {
      const ts = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000).toISOString()
      expect(formatRelative(ts, 'zh')).toBe(formatRelative(ts))
    })
  })

  describe('locale=en', () => {
    // date-fns formatDistanceToNow without includeSeconds rounds <45s to "less than a minute"
    it('formats short durations in English (less than a minute)', () => {
      const ts = new Date(FIXED_NOW.getTime() - 30 * 1000).toISOString()
      expect(formatRelative(ts, 'en')).toMatch(/minute/)
    })

    it('formats minutes ago in English', () => {
      const ts = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000).toISOString()
      expect(formatRelative(ts, 'en')).toMatch(/minute/)
    })

    it('formats hours ago in English', () => {
      const ts = new Date(FIXED_NOW.getTime() - 3 * 3600 * 1000).toISOString()
      expect(formatRelative(ts, 'en')).toMatch(/hour/)
    })

    it('formats days ago in English', () => {
      const ts = new Date(FIXED_NOW.getTime() - 2 * 86400 * 1000).toISOString()
      expect(formatRelative(ts, 'en')).toMatch(/day/)
    })

    it('includes "ago" suffix', () => {
      const ts = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000).toISOString()
      expect(formatRelative(ts, 'en')).toMatch(/ago/)
    })
  })
})
