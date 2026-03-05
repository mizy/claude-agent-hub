/**
 * 时间处理工具 — 薄路由层
 * 实际实现拆分到 formatters/ 子模块
 */

import { format, parseISO, differenceInMilliseconds } from 'date-fns'

// Re-export formatters
export { type TimeLocale, formatDuration } from './formatters/formatDuration.js'
export { formatRelative } from './formatters/formatRelative.js'
export { formatTimeRange } from './formatters/formatTimeRange.js'

// ISO 时间戳
export function now(): string {
  return new Date().toISOString()
}

// 格式化为可读时间
export function formatTime(isoString: string, pattern: string = 'yyyy-MM-dd HH:mm:ss'): string {
  return format(parseISO(isoString), pattern)
}

// 计算时间差（毫秒）
export function timeDiff(start: string, end: string): number {
  return differenceInMilliseconds(parseISO(end), parseISO(start))
}

// 解析时间间隔字符串（如 "5m", "1h", "1d"）
export function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)([smhd])$/)
  if (!match) throw new Error(`Invalid interval format: ${interval}`)

  const value = parseInt(match[1]!, 10)
  const unit = match[2]!

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }

  return value * multipliers[unit]!
}

// 将间隔转换为 cron 表达式
export function intervalToCron(interval: string, fallback = '*/5 * * * *'): string {
  const match = interval.match(/^(\d+)([mhd])$/)
  if (!match) return fallback

  const value = parseInt(match[1]!, 10)
  const unit = match[2]!

  switch (unit) {
    case 'm':
      return `*/${value} * * * *`
    case 'h':
      return `0 */${value} * * *`
    case 'd':
      return `0 0 */${value} * *`
    default:
      return fallback
  }
}
