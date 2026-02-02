/**
 * 时间处理工具
 * 基于 date-fns 的轻量封装
 */

import { format, formatDistanceToNow, parseISO, differenceInMilliseconds } from 'date-fns'
import { zhCN } from 'date-fns/locale'

// ISO 时间戳
export function now(): string {
  return new Date().toISOString()
}

// 格式化为可读时间
export function formatTime(isoString: string, pattern: string = 'yyyy-MM-dd HH:mm:ss'): string {
  return format(parseISO(isoString), pattern)
}

// 相对时间（如 "3 分钟前"）
export function formatRelative(isoString: string): string {
  return formatDistanceToNow(parseISO(isoString), {
    addSuffix: true,
    locale: zhCN,
  })
}

// 计算时间差（毫秒）
export function timeDiff(start: string, end: string): number {
  return differenceInMilliseconds(parseISO(end), parseISO(start))
}

// 格式化持续时间
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
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
export function intervalToCron(interval: string): string {
  const match = interval.match(/^(\d+)([mhd])$/)
  if (!match) throw new Error(`Invalid interval format: ${interval}`)

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
      throw new Error(`Unsupported interval unit: ${unit}`)
  }
}
