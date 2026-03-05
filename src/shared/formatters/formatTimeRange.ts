import { format, parseISO, differenceInMilliseconds } from 'date-fns'
import { formatDuration, type TimeLocale } from './formatDuration.js'

export function formatTimeRange(start: string, end: string, locale: TimeLocale = 'en'): string {
  const startDate = parseISO(start)
  const endDate = parseISO(end)

  const startStr = format(startDate, 'yyyy-MM-dd HH:mm')
  const durationMs = differenceInMilliseconds(endDate, startDate)
  const durationStr = durationMs > 0 ? ` (${formatDuration(durationMs, locale)})` : ''

  const sameDay =
    startDate.getFullYear() === endDate.getFullYear() &&
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getDate() === endDate.getDate()

  const endStr = sameDay ? format(endDate, 'HH:mm') : format(endDate, 'yyyy-MM-dd HH:mm')

  return `${startStr} ~ ${endStr}${durationStr}`
}
