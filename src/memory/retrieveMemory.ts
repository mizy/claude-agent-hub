/**
 * Memory retrieval — score, rank, and return relevant memories
 *
 * Integrates forgetting engine (strength filtering) and association engine
 * (associative expansion when direct results are insufficient).
 */

import { extractKeywords } from '../analysis/index.js'
import { getAllMemories, updateMemory } from '../store/MemoryStore.js'
import { migrateMemoryEntry } from './migrateMemory.js'
import { calculateStrength, reinforceMemory } from './forgettingEngine.js'
import { spreadActivation } from './associationEngine.js'
import { loadConfig } from '../config/loadConfig.js'
import type { MemoryEntry } from './types.js'

interface RetrieveOptions {
  maxResults?: number
  projectPath?: string
}

/**
 * Retrieve memories most relevant to a query.
 *
 * Scoring: keyword overlap + strength factor + project path bonus + confidence.
 * Filters out memories with very low strength (< 10).
 * When direct keyword results < maxResults, expands via association spreading.
 * Auto-reinforces returned entries with 'access' reason.
 */
export async function retrieveRelevantMemories(
  query: string,
  options?: RetrieveOptions,
): Promise<MemoryEntry[]> {
  const maxResults = options?.maxResults ?? 10
  const projectPath = options?.projectPath
  const queryKeywords = extractKeywords(query)
  if (queryKeywords.length === 0) return []

  const now = new Date()
  const all = getAllMemories().map(migrateMemoryEntry)

  // Filter out very weak memories (strength < 10 = effectively forgotten)
  const active = all.filter(entry => calculateStrength(entry, now) >= 10)

  const scored = active.map(entry => {
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
    score += entry.confidence * 0.3

    // Strength factor: replaces old time decay with forgetting curve
    const strength = calculateStrength(entry, now)
    score += (strength / 100) * 0.5

    // Access frequency boost
    score += Math.log(1 + entry.accessCount) * 0.2

    return { entry, score }
  })

  // Filter out zero-score entries, sort descending, take top N
  const directResults = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.entry)

  // Associative expansion: when direct results are insufficient, spread activation
  let results = directResults
  const config = await loadConfig()
  if (config.memory.association.enabled && directResults.length < maxResults && directResults.length > 0) {
    const resultIds = new Set(directResults.map(e => e.id))
    const associated: MemoryEntry[] = []

    for (const seed of directResults.slice(0, 3)) {
      const spread = await spreadActivation(seed.id, active)
      for (const { entry } of spread) {
        if (!resultIds.has(entry.id)) {
          resultIds.add(entry.id)
          associated.push(entry)
        }
      }
    }

    const remaining = maxResults - directResults.length
    results = [...directResults, ...associated.slice(0, remaining)]
  }

  // Update accessCount, lastAccessedAt, and reinforce on access
  for (const entry of results) {
    updateMemory(entry.id, {
      accessCount: entry.accessCount + 1,
      lastAccessedAt: now.toISOString(),
    })
    // Fire-and-forget reinforcement (async but we don't need to wait)
    reinforceMemory(entry.id, 'access').catch(() => {})
  }

  return results
}
