import { describe, it, expect } from 'vitest'
import { formatDuration } from '../formatTime.js'

describe('formatDuration', () => {
  it('returns 0ms for zero', () => {
    expect(formatDuration(0)).toBe('0ms')
  })

  it('returns 0ms for negative values', () => {
    expect(formatDuration(-100)).toBe('0ms')
    expect(formatDuration(-999999)).toBe('0ms')
  })

  it('returns milliseconds for sub-second values', () => {
    expect(formatDuration(1)).toBe('1ms')
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('formats seconds', () => {
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(5000)).toBe('5s')
    expect(formatDuration(59000)).toBe('59s')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m')
    expect(formatDuration(83000)).toBe('1m 23s')
    expect(formatDuration(120000)).toBe('2m')
  })

  it('formats hours, minutes, seconds', () => {
    expect(formatDuration(3600000)).toBe('1h')
    expect(formatDuration(5025000)).toBe('1h 23m 45s')
    expect(formatDuration(7200000)).toBe('2h')
  })

  it('formats days', () => {
    expect(formatDuration(86400000)).toBe('1d')
    expect(formatDuration(90061000)).toBe('1d 1h 1m 1s')
    expect(formatDuration(172800000 + 10800000)).toBe('2d 3h')
  })

  it('omits zero-value units', () => {
    expect(formatDuration(86400000 + 5000)).toBe('1d 5s')
    expect(formatDuration(3600000 + 1000)).toBe('1h 1s')
  })

  describe('locale=zh', () => {
    it('returns 0ms for zero', () => {
      expect(formatDuration(0, 'zh')).toBe('0ms')
    })

    it('returns milliseconds for sub-second values', () => {
      expect(formatDuration(500, 'zh')).toBe('500ms')
    })

    it('formats seconds in Chinese', () => {
      expect(formatDuration(5000, 'zh')).toBe('5秒')
      expect(formatDuration(59000, 'zh')).toBe('59秒')
    })

    it('formats minutes in Chinese', () => {
      expect(formatDuration(60000, 'zh')).toBe('1分钟')
      expect(formatDuration(83000, 'zh')).toBe('1分钟 23秒')
    })

    it('formats hours in Chinese', () => {
      expect(formatDuration(3600000, 'zh')).toBe('1小时')
      expect(formatDuration(5025000, 'zh')).toBe('1小时 23分钟 45秒')
    })

    it('formats days in Chinese', () => {
      expect(formatDuration(86400000, 'zh')).toBe('1天')
      expect(formatDuration(90061000, 'zh')).toBe('1天 1小时 1分钟 1秒')
    })
  })

  describe('locale=en (explicit)', () => {
    it('uses English units when explicitly passed', () => {
      expect(formatDuration(5000, 'en')).toBe('5s')
      expect(formatDuration(83000, 'en')).toBe('1m 23s')
      expect(formatDuration(5025000, 'en')).toBe('1h 23m 45s')
      expect(formatDuration(90061000, 'en')).toBe('1d 1h 1m 1s')
    })
  })
})
