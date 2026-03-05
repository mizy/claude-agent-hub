import { formatDistanceToNow, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { TimeLocale } from './formatDuration.js'

export function formatRelative(isoString: string, locale: TimeLocale = 'zh'): string {
  return formatDistanceToNow(parseISO(isoString), {
    addSuffix: true,
    locale: locale === 'zh' ? zhCN : undefined,
  })
}
