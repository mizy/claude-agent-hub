/**
 * Memory retrieval — score, rank, and return relevant memories
 */

import { extractKeywords } from '../analysis/index.js'
import { getAllMemories, updateMemory } from '../store/MemoryStore.js'
import type { MemoryEntry } from './types.js'

interface RetrieveOptions {
  maxResults?: number
  projectPath?: string
}

/**
 * Retrieve memories most relevant to a query.
 *
 * Scoring: keyword overlap + project path bonus + confidence + smooth time decay + access frequency.
 * Updates accessCount and lastAccessedAt (NOT updatedAt) on returned entries.
 */
export function retrieveRelevantMemories(
  query: string,
  options?: RetrieveOptions,
): MemoryEntry[] {
  const maxResults = options?.maxResults ?? 10
  const projectPath = options?.projectPath
  const queryKeywords = extractKeywords(query)
  if (queryKeywords.length === 0) return []

  const all = getAllMemories()
  const now = Date.now()

  const scored = all.map(entry => {
    let score = 0

    // Keyword overlap (0-1 range, weighted heavily)
    const overlap = queryKeywords.filter(
      qk => entry.keywords.some(ek => ek.includes(qk) || qk.includes(ek)),
    ).length
    score += (overlap / queryKeywords.length) * 2

    // Project path match bonus
    if (projectPath && entry.projectPath === projectPath) {
      score += 0.3
    }

    // Confidence factor
    score += entry.confidence * 0.5

    // Smooth time decay: 1 / (1 + ageDays / 30)
    // 7d=0.81, 30d=0.5, 90d=0.25 — based on updatedAt (content last modified)
    const ageMs = now - new Date(entry.updatedAt).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    score *= 1 / (1 + ageDays / 30)

    // Access frequency boost: frequently accessed memories are more useful
    score += Math.log(1 + entry.accessCount) * 0.2

    return { entry, score }
  })

  // Filter out zero-score entries, sort descending, take top N
  const results = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.entry)

  // Update accessCount and lastAccessedAt (NOT updatedAt) for returned entries
  for (const entry of results) {
    updateMemory(entry.id, {
      accessCount: entry.accessCount + 1,
      lastAccessedAt: new Date().toISOString(),
    })
  }

  return results
}
