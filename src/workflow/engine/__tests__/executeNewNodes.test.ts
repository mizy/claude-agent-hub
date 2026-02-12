import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { calculateNextCronTime } from '../executeNewNodes.js'

describe('calculateNextCronTime', () => {
  beforeEach(() => {
    // Fix "now" to 2026-02-10 12:30:00 UTC
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T12:30:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should parse daily cron (0 9 * * *) with UTC timezone', () => {
    const next = calculateNextCronTime('0 9 * * *', 'UTC')
    expect(next).toBeInstanceOf(Date)
    // Current time is 12:30 UTC, next 09:00 UTC is tomorrow
    expect(next!.toISOString()).toBe('2026-02-11T09:00:00.000Z')
  })

  it('should parse periodic cron (*/5 * * * *) with UTC timezone', () => {
    const next = calculateNextCronTime('*/5 * * * *', 'UTC')
    expect(next).toBeInstanceOf(Date)
    // Current time is 12:30 UTC, next */5 is 12:35
    expect(next!.toISOString()).toBe('2026-02-10T12:35:00.000Z')
  })

  it('should parse weekly cron (0 0 * * 1) with UTC timezone', () => {
    // 2026-02-10 is Tuesday, next Monday is 2026-02-16
    const next = calculateNextCronTime('0 0 * * 1', 'UTC')
    expect(next).toBeInstanceOf(Date)
    expect(next!.toISOString()).toBe('2026-02-16T00:00:00.000Z')
  })

  it('should return null for invalid expressions', () => {
    expect(calculateNextCronTime('invalid')).toBeNull()
    expect(calculateNextCronTime('60 25 * * *')).toBeNull()
  })

  it('should respect timezone parameter', () => {
    // At 12:30 UTC, it's 20:30 in Asia/Shanghai (UTC+8)
    // "0 21 * * *" in Shanghai = 13:00 UTC. Since now is 12:30 UTC, next is today
    const nextShanghai = calculateNextCronTime('0 21 * * *', 'Asia/Shanghai')
    expect(nextShanghai).toBeInstanceOf(Date)
    expect(nextShanghai!.toISOString()).toBe('2026-02-10T13:00:00.000Z')

    // "0 21 * * *" in UTC. Since now is 12:30 UTC, next 21:00 UTC is today
    const nextUtc = calculateNextCronTime('0 21 * * *', 'UTC')
    expect(nextUtc).toBeInstanceOf(Date)
    expect(nextUtc!.toISOString()).toBe('2026-02-10T21:00:00.000Z')
  })

  it('should handle monthly cron (0 0 1 * *) with UTC timezone', () => {
    const next = calculateNextCronTime('0 0 1 * *', 'UTC')
    expect(next).toBeInstanceOf(Date)
    // Next 1st of month after Feb 10 is March 1
    expect(next!.toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })

  it('should return a future date', () => {
    const next = calculateNextCronTime('* * * * *', 'UTC')
    expect(next).toBeInstanceOf(Date)
    expect(next!.getTime()).toBeGreaterThan(Date.now())
  })
})
