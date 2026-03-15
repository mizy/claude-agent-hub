/**
 * Collect chat statistics from conversation.jsonl
 *
 * Reads the global IM conversation log and computes messaging metrics.
 * Pure read-only — never modifies the source file.
 */

import { readFileSync } from 'fs'
import { CONVERSATION_LOG_FILE_PATH } from '../store/paths.js'
import { getErrorMessage } from '../shared/assertError.js'
import { createLogger } from '../shared/logger.js'
import type { ConversationEntry } from '../store/conversationLog.js'
import type { ChatStats, HourDistribution, WeekdayDistribution, ChannelStats } from './types.js'

const logger = createLogger('stats-chat')
const CONVERSATION_LOG_PATH = CONVERSATION_LOG_FILE_PATH

/** Parse all entries from conversation.jsonl */
function parseAllEntries(): ConversationEntry[] {
  try {
    const content = readFileSync(CONVERSATION_LOG_PATH, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const entries: ConversationEntry[] = []
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as ConversationEntry)
      } catch {
        // skip malformed lines
      }
    }
    return entries
  } catch (error) {
    logger.debug(`Failed to read conversation log: ${getErrorMessage(error)}`)
    return []
  }
}

/** Count unique values for a field */
function countUnique(entries: ConversationEntry[], field: 'sessionId'): number {
  const set = new Set<string>()
  for (const e of entries) {
    const val = e[field]
    if (val) set.add(val)
  }
  return set.size
}

/** Calculate consecutive-day streaks */
function calcStreaks(entries: ConversationEntry[]): { longest: number; current: number } {
  if (entries.length === 0) return { longest: 0, current: 0 }

  // Collect unique active dates (YYYY-MM-DD)
  const dateSet = new Set<string>()
  for (const e of entries) {
    dateSet.add(e.ts.slice(0, 10))
  }
  const sortedDates = [...dateSet].sort()
  if (sortedDates.length === 0) return { longest: 0, current: 0 }

  let longest = 1
  let current = 1
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1]!).getTime()
    const curr = new Date(sortedDates[i]!).getTime()
    const diffDays = (curr - prev) / 86400000

    if (diffDays === 1) {
      current++
    } else {
      current = 1
    }
    if (current > longest) longest = current
  }

  // Check if current streak is still active (last date is today or yesterday)
  const lastDate = sortedDates[sortedDates.length - 1]!
  if (lastDate !== today && lastDate !== yesterday) {
    current = 0
  }

  return { longest, current }
}

/** Calculate unique active periods */
function calcActivePeriods(entries: ConversationEntry[]) {
  const days = new Set<string>()
  const weeks = new Set<string>()
  const months = new Set<string>()

  for (const e of entries) {
    const d = new Date(e.ts)
    days.add(e.ts.slice(0, 10))
    // ISO week: year + week number
    const jan1 = new Date(d.getFullYear(), 0, 1)
    const weekNum = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
    weeks.add(`${d.getFullYear()}-W${weekNum}`)
    months.add(e.ts.slice(0, 7))
  }
  return { days: days.size, weeks: weeks.size, months: months.size }
}

/** Build hour distribution (0-23) */
function buildHourDistribution(entries: ConversationEntry[]): HourDistribution[] {
  const counts = new Array(24).fill(0) as number[]
  for (const e of entries) {
    const hour = new Date(e.ts).getHours()
    counts[hour]!++
  }
  return counts.map((count, hour) => ({ hour, count }))
}

/** Build weekday distribution (0=Sunday) */
function buildWeekdayDistribution(entries: ConversationEntry[]): WeekdayDistribution[] {
  const counts = new Array(7).fill(0) as number[]
  for (const e of entries) {
    const day = new Date(e.ts).getDay()
    counts[day]!++
  }
  return counts.map((count, day) => ({ day, count }))
}

/** Build channel distribution */
function buildChannelDistribution(entries: ConversationEntry[]): ChannelStats[] {
  const platformCounts: Record<string, number> = {}
  for (const e of entries) {
    const p = e.platform || 'unknown'
    platformCounts[p] = (platformCounts[p] || 0) + 1
  }

  const total = entries.length || 1
  return Object.entries(platformCounts)
    .map(([platform, messageCount]) => ({
      platform,
      messageCount,
      percentage: Math.round((messageCount / total) * 1000) / 10,
    }))
    .sort((a, b) => b.messageCount - a.messageCount)
}

/** Calculate average text length for a direction */
function avgTextLength(entries: ConversationEntry[], dir: 'in' | 'out'): number {
  const filtered = entries.filter(e => e.dir === dir && e.text)
  if (filtered.length === 0) return 0
  const totalLen = filtered.reduce((sum, e) => sum + e.text.length, 0)
  return Math.round(totalLen / filtered.length)
}

/** @entry Collect all chat statistics */
export function collectChatStats(): ChatStats {
  const entries = parseAllEntries()

  const inbound = entries.filter(e => e.dir === 'in').length
  const outbound = entries.filter(e => e.dir === 'out').length
  const events = entries.filter(e => e.dir === 'event').length
  const commands = entries.filter(e => e.dir === 'cmd').length

  // Average response time (only outbound with durationMs)
  const responseTimes = entries.filter(e => e.dir === 'out' && e.durationMs != null)
  const avgResponseMs =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((s, e) => s + e.durationMs!, 0) / responseTimes.length)
      : 0

  // Total cost
  const totalCostUsd = entries
    .filter(e => e.costUsd != null)
    .reduce((s, e) => s + e.costUsd!, 0)

  const activePeriods = calcActivePeriods(entries)
  const streaks = calcStreaks(entries)

  return {
    totalMessages: entries.length,
    inbound,
    outbound,
    events,
    commands,
    sessionCount: countUnique(entries, 'sessionId'),
    activeDays: activePeriods.days,
    activeWeeks: activePeriods.weeks,
    activeMonths: activePeriods.months,
    avgResponseMs,
    hourDistribution: buildHourDistribution(entries),
    weekdayDistribution: buildWeekdayDistribution(entries),
    avgUserMessageLength: avgTextLength(entries, 'in'),
    avgAiMessageLength: avgTextLength(entries, 'out'),
    channelDistribution: buildChannelDistribution(entries),
    longestStreak: streaks.longest,
    currentStreak: streaks.current,
    totalCostUsd,
  }
}
