/**
 * Growth Journal — verifiable growth records
 *
 * Records evolution events, feature additions, fixes, and optimizations
 * so CAH can answer "what did I grow this month?"
 *
 * Storage: ~/.cah-data/consciousness/growth-journal.jsonl (one entry per line)
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { GROWTH_JOURNAL_PATH } from '../store/paths.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { computeTaskMetrics, type EvolutionMetrics } from './computeEvolutionMetrics.js'

const logger = createLogger('consciousness:growth')

// ============ Types ============

export type GrowthChangeType = 'feature' | 'fix' | 'refactor' | 'optimization' | 'evolution'

export interface GrowthMetrics {
  taskSuccessRate?: number
  avgTaskDurationMs?: number
  codeQuality?: number
  autonomyLevel?: number
  /** Structured evolution metrics with period info */
  evolution?: EvolutionMetrics
}

export interface GrowthJournalEntry {
  id: string
  date: string // ISO timestamp
  changeType: GrowthChangeType
  description: string
  filesChanged: string[]
  beforeMetrics?: GrowthMetrics
  afterMetrics?: GrowthMetrics
  milestone?: string
  taskId?: string
  source?: string // e.g. 'selfevolve', 'task', 'manual'
}

// ============ Core Functions ============

/** Append a growth entry to the journal, auto-computing beforeMetrics and backfilling afterMetrics */
export function recordGrowth(entry: GrowthJournalEntry): void {
  try {
    const dir = dirname(GROWTH_JOURNAL_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    // Auto-compute beforeMetrics: past 7 days of task performance
    if (!entry.beforeMetrics) {
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const metrics = computeTaskMetrics(sevenDaysAgo, now)
      if (metrics) {
        entry.beforeMetrics = { evolution: metrics }
      }
    }

    // Append new entry first (safe: atomic single-line append)
    appendFileSync(GROWTH_JOURNAL_PATH, JSON.stringify(entry) + '\n')

    // Then backfill afterMetrics on previous entry (read-modify-write, failure is non-critical)
    backfillAfterMetrics()
    logger.info(`Growth recorded: [${entry.changeType}] ${entry.description}`)
  } catch (e) {
    logger.warn(`Failed to record growth: ${getErrorMessage(e)}`)
  }
}

/**
 * Find the most recent entry with beforeMetrics but no afterMetrics, and backfill.
 *
 * Concurrency note: This does a read-modify-write on the JSONL file, which is NOT
 * safe under concurrent writes. This is acceptable because the daemon executes tasks
 * serially (single process), so recordGrowth is never called concurrently.
 * If concurrency is ever introduced, add file locking (e.g. proper-lockfile).
 */
function backfillAfterMetrics(): void {
  try {
    if (!existsSync(GROWTH_JOURNAL_PATH)) return
    const content = readFileSync(GROWTH_JOURNAL_PATH, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    if (lines.length === 0) return

    // Find latest entry needing backfill (scan from end)
    let targetIdx = -1
    let targetEntry: GrowthJournalEntry | null = null
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const line = lines[i]
        if (!line) continue
        const entry = JSON.parse(line) as GrowthJournalEntry
        if (entry.beforeMetrics && !entry.afterMetrics) {
          targetIdx = i
          targetEntry = entry
          break
        }
      } catch { /* skip */ }
    }

    if (targetIdx < 0 || !targetEntry) return

    // Compute afterMetrics: from the entry's date to now
    const entryDate = new Date(targetEntry.date)
    const now = new Date()
    const metrics = computeTaskMetrics(entryDate, now)
    if (!metrics) return

    targetEntry.afterMetrics = { evolution: metrics }
    lines[targetIdx] = JSON.stringify(targetEntry)
    // Atomic write: write to temp file then rename to avoid partial-write corruption
    const tmpPath = join(dirname(GROWTH_JOURNAL_PATH), `.growth-journal.tmp.${process.pid}`)
    writeFileSync(tmpPath, lines.join('\n') + '\n')
    renameSync(tmpPath, GROWTH_JOURNAL_PATH)
    logger.info(`Backfilled afterMetrics for entry ${targetEntry.id}`)
  } catch (e) {
    logger.debug(`afterMetrics backfill skipped: ${getErrorMessage(e)}`)
  }
}

/** Load all growth entries, optionally filtered by date */
export function loadGrowthJournal(since?: Date): GrowthJournalEntry[] {
  try {
    if (!existsSync(GROWTH_JOURNAL_PATH)) return []
    const content = readFileSync(GROWTH_JOURNAL_PATH, 'utf-8')
    const entries: GrowthJournalEntry[] = []
    for (const line of content.trim().split('\n')) {
      if (!line) continue
      try {
        const entry = JSON.parse(line) as GrowthJournalEntry
        if (since && new Date(entry.date) < since) continue
        entries.push(entry)
      } catch {
        // skip malformed lines
      }
    }
    return entries
  } catch (e) {
    logger.debug(`Failed to load growth journal: ${getErrorMessage(e)}`)
    return []
  }
}

/** Get growth summary aggregated by period */
export function getGrowthSummary(period: 'week' | 'month'): GrowthSummary {
  const now = new Date()
  const since = new Date(now)
  if (period === 'week') {
    since.setDate(since.getDate() - 7)
  } else {
    since.setMonth(since.getMonth() - 1)
  }

  const entries = loadGrowthJournal(since)
  const byType: Record<GrowthChangeType, number> = {
    feature: 0, fix: 0, refactor: 0, optimization: 0, evolution: 0,
  }
  for (const e of entries) {
    byType[e.changeType] = (byType[e.changeType] || 0) + 1
  }

  const milestones = entries.filter(e => e.milestone).map(e => ({
    date: e.date,
    milestone: e.milestone!,
    changeType: e.changeType,
  }))

  return {
    period,
    since: since.toISOString(),
    totalEntries: entries.length,
    byType,
    milestones,
  }
}

export interface GrowthSummary {
  period: 'week' | 'month'
  since: string
  totalEntries: number
  byType: Record<GrowthChangeType, number>
  milestones: { date: string; milestone: string; changeType: GrowthChangeType }[]
}

/** Get all milestone entries */
export function getMilestones(): GrowthJournalEntry[] {
  return loadGrowthJournal().filter(e => e.milestone)
}
