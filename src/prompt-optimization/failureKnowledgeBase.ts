/**
 * Failure Knowledge Base
 *
 * Persists classified failures as structured records.
 * Enables querying failure patterns by category, persona, or time range
 * to inform prompt evolution decisions.
 */

import { join } from 'path'
import { FileStore } from '../store/GenericFileStore.js'
import { DATA_DIR } from '../store/paths.js'
import { generateShortId } from '../shared/generateId.js'
import { createLogger } from '../shared/logger.js'
import type { FailureCategory } from './classifyFailure.js'
import type { FailedNodeInfo } from '../types/promptVersion.js'

const logger = createLogger('failure-kb')

// ============ Types ============

export interface FailureRecord {
  id: string
  taskId: string
  personaName: string
  versionId: string
  category: FailureCategory
  confidence: number
  matchedPatterns: string[]
  failedNodes: FailedNodeInfo[]
  rootCause?: string // from LLM analysis
  suggestion?: string // from LLM analysis
  recordedAt: string
}

export interface FailureStats {
  totalFailures: number
  byCategory: Record<string, number>
  topPatterns: Array<{ pattern: string; count: number }>
  recentTrend: 'improving' | 'degrading' | 'stable'
}

// ============ Store ============

const FAILURE_KB_DIR = join(DATA_DIR, 'failure-kb')

let store: FileStore<FailureRecord> | null = null

function getStore(): FileStore<FailureRecord> {
  if (!store) {
    store = new FileStore<FailureRecord>({ dir: FAILURE_KB_DIR, mode: 'file', ext: '.json' })
  }
  return store
}

/** @internal - for testing only */
export function resetStore(clean = false): void {
  if (clean && store) {
    for (const id of store.listSync()) {
      store.deleteSync(id)
    }
  }
  store = null
}

// ============ Core Functions ============

/** Record a failure into the knowledge base */
export function recordFailure(params: {
  taskId: string
  personaName: string
  versionId: string
  category: FailureCategory
  confidence: number
  matchedPatterns: string[]
  failedNodes: FailedNodeInfo[]
  rootCause?: string
  suggestion?: string
}): FailureRecord {
  const record: FailureRecord = {
    id: `fk-${Date.now()}-${generateShortId()}`,
    ...params,
    recordedAt: new Date().toISOString(),
  }

  getStore().setSync(record.id, record)
  logger.debug(`Recorded failure ${record.id}: ${record.category} (${record.confidence})`)
  return record
}

/** Get all failure records, newest first */
export function getAllFailures(): FailureRecord[] {
  return getStore()
    .getAllSync()
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
}

/** Get failures by category */
export function getFailuresByCategory(category: FailureCategory): FailureRecord[] {
  return getAllFailures().filter(r => r.category === category)
}

/** Get failures for a specific persona */
export function getFailuresByPersona(personaName: string): FailureRecord[] {
  return getAllFailures().filter(r => r.personaName === personaName)
}

/** Get recent failures (last N days) */
export function getRecentFailures(days = 7): FailureRecord[] {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString()
  return getAllFailures().filter(r => r.recordedAt >= cutoff)
}

/**
 * Compute failure statistics for informed evolution decisions.
 * Analyzes category distribution, top patterns, and trend.
 */
export function computeFailureStats(personaName?: string): FailureStats {
  const all = personaName ? getFailuresByPersona(personaName) : getAllFailures()

  // Category distribution
  const byCategory: Record<string, number> = {}
  const patternCounts = new Map<string, number>()

  for (const record of all) {
    byCategory[record.category] = (byCategory[record.category] ?? 0) + 1
    for (const p of record.matchedPatterns) {
      patternCounts.set(p, (patternCounts.get(p) ?? 0) + 1)
    }
  }

  // Top patterns sorted by count
  const topPatterns = [...patternCounts.entries()]
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Trend: compare last 7 days vs previous 7 days
  const now = Date.now()
  const week1 = all.filter(r => {
    const t = new Date(r.recordedAt).getTime()
    return t >= now - 7 * 86400_000
  }).length
  const week2 = all.filter(r => {
    const t = new Date(r.recordedAt).getTime()
    return t >= now - 14 * 86400_000 && t < now - 7 * 86400_000
  }).length

  let recentTrend: FailureStats['recentTrend'] = 'stable'
  if (week2 > 0) {
    const ratio = week1 / week2
    if (ratio < 0.7) recentTrend = 'improving'
    else if (ratio > 1.3) recentTrend = 'degrading'
  }

  return {
    totalFailures: all.length,
    byCategory,
    topPatterns,
    recentTrend,
  }
}

/**
 * Format failure knowledge for injection into workflow generation prompt.
 * Returns a concise summary of known failure patterns to help AI avoid them.
 */
export function formatFailureKnowledgeForPrompt(personaName?: string): string {
  const stats = computeFailureStats(personaName)
  if (stats.totalFailures === 0) return ''

  const lines: string[] = ['## 已知失败模式（基于历史数据）\n']

  // Top failure categories
  const sortedCategories = Object.entries(stats.byCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  if (sortedCategories.length > 0) {
    lines.push('常见失败类型:')
    for (const [cat, count] of sortedCategories) {
      lines.push(`- ${cat}: ${count} 次`)
    }
    lines.push('')
  }

  // Recent suggestions from LLM analysis
  const recent = getRecentFailures(14)
    .filter(r => r.suggestion)
    .slice(0, 3)

  if (recent.length > 0) {
    lines.push('近期失败教训:')
    for (const r of recent) {
      lines.push(`- [${r.category}] ${r.suggestion}`)
    }
    lines.push('')
  }

  lines.push(`趋势: ${stats.recentTrend === 'improving' ? '改善中' : stats.recentTrend === 'degrading' ? '恶化中' : '稳定'}`)

  return lines.join('\n')
}
