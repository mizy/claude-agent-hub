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
import { retrieveEpisodes } from './retrieveEpisode.js'
import { shouldRetrieveEpisode, formatEpisodeContext } from './injectEpisode.js'
import { formatMemoriesForPrompt } from './formatMemory.js'
import { createLogger } from '../shared/logger.js'
import { loadConfig } from '../config/loadConfig.js'
import type { MemoryEntry } from './types.js'

const logger = createLogger('memory')

interface RetrieveOptions {
  maxResults?: number
  projectPath?: string
}

// Backend names and other domain-specific terms get higher match weight
const HIGH_VALUE_KEYWORDS = new Set([
  'iflow', 'opencode', 'codebuddy', 'local', 'openai', 'claude',
  'backend', 'daemon', 'workflow', 'persona', 'memory', 'lark', 'telegram',
])

/** Strip @, punctuation, and normalize for matching */
function normalizeKeyword(kw: string): string {
  return kw.replace(/^[@#]+/, '').replace(/[^\w\u4e00-\u9fff]/g, '').toLowerCase()
}

/** Check if two keywords match (with normalization and fuzzy prefix) */
function keywordMatch(queryKw: string, entryKw: string): number {
  const nq = normalizeKeyword(queryKw)
  const ne = normalizeKeyword(entryKw)
  if (!nq || !ne) return 0

  // Exact match after normalization
  if (nq === ne) return 1.0
  // Substring containment (e.g. 'iflow' matches 'iflow_backend')
  if (ne.includes(nq) || nq.includes(ne)) return 0.8
  // Prefix match (e.g. 'config' matches 'configuration')
  if (ne.startsWith(nq) || nq.startsWith(ne)) return 0.6

  return 0
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
  const maxResults = Math.min(options?.maxResults ?? 8, 8)
  const projectPath = options?.projectPath
  const queryKeywords = extractKeywords(query)
  if (queryKeywords.length === 0) return []

  const now = new Date()
  const all = getAllMemories().map(migrateMemoryEntry)

  // Filter out very weak memories (strength < 10 = effectively forgotten)
  const active = all.filter(entry => calculateStrength(entry, now) >= 10)

  const scored = active.map(entry => {
    let score = 0

    // Keyword overlap with fuzzy matching and domain keyword boost
    let keywordScore = 0
    for (const qk of queryKeywords) {
      let bestMatch = 0
      for (const ek of entry.keywords) {
        bestMatch = Math.max(bestMatch, keywordMatch(qk, ek))
      }
      if (bestMatch > 0) {
        // High-value keywords (backend names etc.) get 1.5x weight
        const weight = HIGH_VALUE_KEYWORDS.has(normalizeKeyword(qk)) ? 1.5 : 1.0
        keywordScore += bestMatch * weight
      }
    }
    // Normalize: use max of query length and entry keywords length to prevent
    // short queries from getting inflated scores
    const normalizer = Math.max(queryKeywords.length, entry.keywords.length, 1)
    score += (keywordScore / normalizer) * 2

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

    return { entry, score, keywordScore }
  })

  // Filter out entries with no keyword overlap, sort descending, take top N
  const directResults = scored
    .filter(s => s.keywordScore > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.entry)

  // Associative expansion: when direct results are insufficient, spread activation
  let results = directResults
  const config = await loadConfig()
  if (config.memory.association.enabled && directResults.length < maxResults) {
    const resultIds = new Set(directResults.map(e => e.id))
    const associated: MemoryEntry[] = []

    if (directResults.length > 0) {
      // Expand from direct results
      for (const seed of directResults.slice(0, 3)) {
        const spread = await spreadActivation(seed.id, active)
        for (const { entry } of spread) {
          if (!resultIds.has(entry.id)) {
            resultIds.add(entry.id)
            associated.push(entry)
          }
        }
      }
    } else {
      // Zero direct results: try keyword-based association from all active memories
      // Find any memory that has at least one matching keyword and use it as seed
      // Limit scan to avoid O(n²) on large memory stores
      const scanLimit = Math.min(active.length, 50)
      for (let i = 0; i < scanLimit; i++) {
        const entry = active[i]!
        let hasMatch = false
        for (const qk of queryKeywords) {
          if (hasMatch) break
          for (const ek of entry.keywords) {
            if (keywordMatch(qk, ek) > 0) {
              hasMatch = true
              break
            }
          }
        }
        if (hasMatch && !resultIds.has(entry.id)) {
          resultIds.add(entry.id)
          const spread = await spreadActivation(entry.id, active)
          for (const { entry: assocEntry } of spread) {
            if (!resultIds.has(assocEntry.id)) {
              resultIds.add(assocEntry.id)
              associated.push(assocEntry)
            }
          }
          if (associated.length >= maxResults) break
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
    reinforceMemory(entry.id, 'access').catch(e => logger.warn(`Memory reinforce failed for ${entry.id}: ${e}`))
  }

  return results
}

/**
 * Retrieve all memory context (semantic + episodic) for a query.
 *
 * Returns formatted string ready for prompt injection.
 * Episodic memory is only retrieved when:
 * 1. enableEpisodicMemory config is true
 * 2. Query contains trigger words (shouldRetrieveEpisode)
 *
 * Output order: episodic context first, then semantic memory.
 */
export async function retrieveAllMemoryContext(
  query: string,
  options?: RetrieveOptions,
): Promise<string> {
  const config = await loadConfig()

  // Retrieve semantic memories
  const memories = await retrieveRelevantMemories(query, options)
  const semanticContext = formatMemoriesForPrompt(memories)

  // Retrieve episodic memories if enabled and triggered
  let episodicContext = ''
  if (config.memory.episodic.enabled && shouldRetrieveEpisode(query)) {
    const memoryIds = memories.map(m => m.id)
    const episodes = retrieveEpisodes({
      query,
      currentMemoryIds: memoryIds,
      limit: 3,
    })
    episodicContext = formatEpisodeContext(episodes)
  }

  // Combine: episodic first, then semantic
  const parts = [episodicContext, semanticContext].filter(Boolean)
  return parts.join('\n\n')
}
