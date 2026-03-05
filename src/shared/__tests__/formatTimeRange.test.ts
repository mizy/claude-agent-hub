import { describe, it, expect } from 'vitest'
import { formatTimeRange } from '../formatters/formatTimeRange.js'

describe('formatTimeRange', () => {
  describe('same day', () => {
    it('omits date in end time when same day', () => {
      const result = formatTimeRange('2026-03-05T09:00:00', '2026-03-05T10:30:00')
      // start has full date, end has only time
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} ~ \d{2}:\d{2}/)
      expect(result).not.toMatch(/~ \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    })

    it('includes duration in en (default)', () => {
      const result = formatTimeRange('2026-03-05T09:00:00', '2026-03-05T10:30:00')
      expect(result).toContain('(1h 30m)')
    })

    it('includes duration in zh', () => {
      const result = formatTimeRange('2026-03-05T09:00:00', '2026-03-05T10:30:00', 'zh')
      expect(result).toContain('(1小时 30分钟)')
    })
  })

  describe('cross-day', () => {
    // Use local datetime strings (no Z) to avoid UTC→local timezone conversion issues
    it('includes full date in end time when different day', () => {
      const result = formatTimeRange('2026-03-05T10:00:00', '2026-03-06T10:00:00')
      // both start and end should have full date
      const parts = result.split(' ~ ')
      expect(parts[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
      expect(parts[1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    })

    it('includes duration in en for cross-day range', () => {
      const result = formatTimeRange('2026-03-05T10:00:00', '2026-03-06T10:00:00')
      expect(result).toContain('(1d)')
    })

    it('includes duration in zh for cross-day range', () => {
      const result = formatTimeRange('2026-03-05T10:00:00', '2026-03-06T10:00:00', 'zh')
      expect(result).toContain('(1天)')
    })
  })

  describe('edge cases', () => {
    it('start == end: no duration suffix', () => {
      const ts = '2026-03-05T10:00:00'
      const result = formatTimeRange(ts, ts)
      expect(result).not.toContain('(')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} ~ \d{2}:\d{2}$/)
    })

    it('start > end: no duration suffix', () => {
      const result = formatTimeRange('2026-03-05T10:00:00', '2026-03-05T09:00:00')
      expect(result).not.toContain('(')
    })

    it('exact 1-minute range', () => {
      const result = formatTimeRange('2026-03-05T10:00:00', '2026-03-05T10:01:00')
      expect(result).toContain('(1m)')
    })

    it('exact 1-day range', () => {
      const result = formatTimeRange('2026-03-05T10:00:00', '2026-03-06T10:00:00')
      expect(result).toContain('(1d)')
    })
  })
})
