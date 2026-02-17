/**
 * Episodic memory retrieval — find relevant conversation episodes
 *
 * Scoring: timeRecency * 0.3 + keywordMatch * 0.4 + semanticLink * 0.3
 */

import { listEpisodes, getEpisode, getEpisodesByTimeRange } from '../store/EpisodeStore.js'
import { createLogger } from '../shared/logger.js'
import type { Episode, EpisodeIndexEntry } from './types.js'

const logger = createLogger('memory:episode')

// Half-life for time recency scoring (7 days in ms)
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000

// Time expression patterns → relative offset in days
// N天前 is handled separately in parseTimeRange via capture group
const TIME_EXPRESSIONS: Array<{ pattern: RegExp; daysAgo: () => number }> = [
  { pattern: /昨天|yesterday/i, daysAgo: () => 1 },
  { pattern: /前天|day before/i, daysAgo: () => 2 },
  { pattern: /上周|last week/i, daysAgo: () => 7 },
  { pattern: /周一|monday/i, daysAgo: () => daysToLastWeekday(1) },
  { pattern: /周二|tuesday/i, daysAgo: () => daysToLastWeekday(2) },
  { pattern: /周三|wednesday/i, daysAgo: () => daysToLastWeekday(3) },
  { pattern: /周四|thursday/i, daysAgo: () => daysToLastWeekday(4) },
  { pattern: /周五|friday/i, daysAgo: () => daysToLastWeekday(5) },
]

function daysToLastWeekday(targetDay: number): number {
  const today = new Date().getDay() // 0=Sun
  const diff = (today - targetDay + 7) % 7
  return diff === 0 ? 7 : diff // if same day, assume last week
}

/** Parse time expressions from query and return a time range */
function parseTimeRange(query: string): { from: Date; to: Date } | null {
  // Handle "N天前" pattern specially since it uses a capture group
  const nDaysMatch = query.match(/(\d+)\s*天前/)
  if (nDaysMatch) {
    const daysAgo = parseInt(nDaysMatch[1] ?? '1')
    return timeRangeForDaysAgo(daysAgo)
  }

  for (const expr of TIME_EXPRESSIONS) {
    if (expr.pattern.test(query)) {
      return timeRangeForDaysAgo(expr.daysAgo())
    }
  }

  // "上次" / "最近" → last 7 days
  if (/上次|最近|recently|last time/i.test(query)) {
    const now = new Date()
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    return { from, to: now }
  }

  return null
}

function timeRangeForDaysAgo(days: number): { from: Date; to: Date } {
  const now = new Date()
  const target = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  // Set range to entire target day
  const from = new Date(target)
  from.setHours(0, 0, 0, 0)
  const to = new Date(target)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

/** Extract keywords from query (simple tokenization) */
function extractQueryKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2)
}

/** Keyword overlap score using Jaccard-like counting */
function calcKeywordScore(queryKeywords: string[], triggerKeywords: string[]): number {
  if (queryKeywords.length === 0 || triggerKeywords.length === 0) return 0
  const triggerLower = triggerKeywords.map(k => k.toLowerCase())
  let matches = 0
  for (const qk of queryKeywords) {
    if (triggerLower.some(tk => tk.includes(qk) || qk.includes(tk))) {
      matches++
    }
  }
  return matches / Math.max(queryKeywords.length, triggerLower.length)
}

/** Time recency score using exponential decay with 7-day half-life */
function calcTimeRecency(episodeTimestamp: string): number {
  const age = Date.now() - new Date(episodeTimestamp).getTime()
  return Math.exp(-age * Math.LN2 / HALF_LIFE_MS)
}

/** Semantic link score: ratio of matching related memory IDs */
function calcSemanticLink(relatedMemories: string[], currentMemoryIds: string[]): number {
  if (relatedMemories.length === 0 || currentMemoryIds.length === 0) return 0
  const currentSet = new Set(currentMemoryIds)
  const matches = relatedMemories.filter(id => currentSet.has(id)).length
  return matches / relatedMemories.length
}

export interface RetrieveEpisodesParams {
  query: string
  currentMemoryIds?: string[]
  limit?: number
}

/**
 * Retrieve episodes most relevant to a query.
 *
 * Uses three scoring dimensions:
 * - timeRecency (0.3): exponential decay, half-life 7 days
 * - keywordMatch (0.4): keyword overlap with triggerKeywords
 * - semanticLink (0.3): related memory ID overlap
 *
 * When query contains time expressions, pre-filters by time range.
 */
export function retrieveEpisodes(params: RetrieveEpisodesParams): Array<Episode & { score: number }> {
  const { query, currentMemoryIds = [], limit = 3 } = params
  const queryKeywords = extractQueryKeywords(query)

  // Pre-filter by time range if query contains time expressions
  const timeRange = parseTimeRange(query)
  let candidates: EpisodeIndexEntry[]
  if (timeRange) {
    candidates = getEpisodesByTimeRange(timeRange.from.toISOString(), timeRange.to.toISOString())
    // Also include recent episodes that match by keyword (time expression might be approximate)
    if (candidates.length === 0) {
      candidates = listEpisodes().slice(0, 20) // fallback to recent
    }
  } else {
    candidates = listEpisodes().slice(0, 50) // scan recent episodes
  }

  // Score each candidate (need full episode data for relatedMemories)
  const scored: Array<Episode & { score: number }> = []
  for (const entry of candidates) {
    const episode = getEpisode(entry.id)
    if (!episode) continue

    const timeRecency = calcTimeRecency(episode.timestamp)
    const keywordMatch = calcKeywordScore(queryKeywords, episode.triggerKeywords)
    const semanticLink = calcSemanticLink(episode.relatedMemories, currentMemoryIds)

    const score = timeRecency * 0.3 + keywordMatch * 0.4 + semanticLink * 0.3

    // Skip zero-score episodes unless time-filtered (time filter implies intent)
    if (score < 0.01 && !timeRange) continue

    scored.push({ ...episode, score })
  }

  scored.sort((a, b) => b.score - a.score)

  const results = scored.slice(0, limit)
  logger.debug(`Retrieved ${results.length} episodes for query: ${query.slice(0, 50)}`)
  return results
}
