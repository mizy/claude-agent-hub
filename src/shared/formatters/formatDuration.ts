export type TimeLocale = 'zh' | 'en'

const UNITS_EN = { d: 'd', h: 'h', m: 'm', s: 's' } as const
const UNITS_ZH = { d: '天', h: '小时', m: '分钟', s: '秒' } as const

export function formatDuration(ms: number, locale: TimeLocale = 'en'): string {
  if (ms <= 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`

  const units = locale === 'zh' ? UNITS_ZH : UNITS_EN
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)

  const parts: string[] = []
  if (days) parts.push(`${days}${units.d}`)
  if (hours) parts.push(`${hours}${units.h}`)
  if (minutes) parts.push(`${minutes}${units.m}`)
  if (seconds) parts.push(`${seconds}${units.s}`)

  return parts.join(' ')
}
