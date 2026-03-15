/**
 * Collect growth trajectory statistics
 *
 * Computes milestones, age, and cumulative metrics from existing data sources.
 */

import { readFileSync, existsSync } from 'fs'
import { CONVERSATION_LOG_FILE_PATH, GROWTH_JOURNAL_PATH } from '../store/paths.js'
import { getAllMemories } from '../store/MemoryStore.js'
import { getErrorMessage } from '../shared/assertError.js'
import { createLogger } from '../shared/logger.js'
import type { GrowthStats, GrowthMilestone, GrowthJournalSummary } from './types.js'

const logger = createLogger('stats-growth')
const CONVERSATION_LOG_PATH = CONVERSATION_LOG_FILE_PATH

// Milestone thresholds for message count
const MESSAGE_MILESTONES = [1, 10, 50, 100, 500, 1000, 2000, 5000, 10000, 50000]

/** Count total memories (tolerates errors) */
function countMemories(): number {
  try {
    return getAllMemories().length
  } catch {
    return 0
  }
}

/** Scan conversation.jsonl for birth date and message milestones */
function scanConversationLog(): {
  birthDate: string
  activeDates: Set<string>
  milestones: GrowthMilestone[]
  totalMessages: number
} {
  const milestones: GrowthMilestone[] = []
  const activeDates = new Set<string>()
  let birthDate = ''
  let totalMessages = 0
  let nextMilestoneIdx = 0

  try {
    const content = readFileSync(CONVERSATION_LOG_PATH, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { ts: string; dir: string }

        if (!birthDate) birthDate = entry.ts
        activeDates.add(entry.ts.slice(0, 10))
        totalMessages++

        // Check milestone thresholds
        while (
          nextMilestoneIdx < MESSAGE_MILESTONES.length &&
          totalMessages >= MESSAGE_MILESTONES[nextMilestoneIdx]!
        ) {
          milestones.push({
            label: `${MESSAGE_MILESTONES[nextMilestoneIdx]} messages`,
            achievedAt: entry.ts,
            value: MESSAGE_MILESTONES[nextMilestoneIdx]!,
          })
          nextMilestoneIdx++
        }
      } catch {
        // skip malformed
      }
    }
  } catch (error) {
    logger.debug(`Failed to read conversation log: ${getErrorMessage(error)}`)
  }

  return { birthDate, activeDates, milestones, totalMessages }
}

/** Collect growth journal summary by reading JSONL directly */
function collectJournalSummary(): GrowthJournalSummary {
  try {
    if (!existsSync(GROWTH_JOURNAL_PATH)) {
      return { totalEntries: 0, byType: {}, recentMilestones: [], weeklyCount: 0, monthlyCount: 0 }
    }
    const content = readFileSync(GROWTH_JOURNAL_PATH, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    const now = new Date()
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - 7)
    const monthAgo = new Date(now)
    monthAgo.setMonth(monthAgo.getMonth() - 1)

    const byType: Record<string, number> = {}
    let weeklyCount = 0
    let monthlyCount = 0
    const recentMilestones: { date: string; milestone: string }[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { date: string; changeType: string; milestone?: string }
        byType[entry.changeType] = (byType[entry.changeType] || 0) + 1
        const entryDate = new Date(entry.date)
        if (entryDate >= weekAgo) weeklyCount++
        if (entryDate >= monthAgo) monthlyCount++
        if (entry.milestone) {
          recentMilestones.push({ date: entry.date, milestone: entry.milestone })
        }
      } catch {
        // skip malformed
      }
    }

    return {
      totalEntries: lines.length,
      byType,
      recentMilestones: recentMilestones.slice(-10),
      weeklyCount,
      monthlyCount,
    }
  } catch {
    return { totalEntries: 0, byType: {}, recentMilestones: [], weeklyCount: 0, monthlyCount: 0 }
  }
}

/** @entry Collect growth trajectory statistics */
export function collectGrowthStats(): GrowthStats {
  const { birthDate, activeDates, milestones } = scanConversationLog()

  const now = new Date()
  const ageDays = birthDate
    ? Math.floor((now.getTime() - new Date(birthDate).getTime()) / 86400000)
    : 0

  return {
    birthDate: birthDate || now.toISOString(),
    ageDays,
    activeDays: activeDates.size,
    milestones,
    totalMemories: countMemories(),
    journal: collectJournalSummary(),
  }
}
