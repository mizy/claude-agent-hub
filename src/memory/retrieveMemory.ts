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
import { queryEntityIndex } from './entityIndex.js'
import { retrieveEpisodes } from './retrieveEpisode.js'
import { shouldRetrieveEpisode, formatEpisodeContext } from './injectEpisode.js'
import { formatMemoriesForPrompt } from './formatMemory.js'
import { createLogger } from '../shared/logger.js'
import { loadConfig } from '../config/loadConfig.js'
import type { MemoryEntry } from './types.js'

const logger = createLogger('memory')

// Simple in-memory retry queue for reinforce operations
const reinforceRetryQueue: Array<{ entryId: string; retries: number }> = []
const MAX_REINFORCE_RETRIES = 2
let retryTimerActive = false

function enqueueReinforceRetry(entryId: string): void {
  reinforceRetryQueue.push({ entryId, retries: 0 })
  if (!retryTimerActive) {
    retryTimerActive = true
    setTimeout(processReinforceRetries, 5000)
  }
}

async function processReinforceRetries(): Promise<void> {
  const batch = reinforceRetryQueue.splice(0, reinforceRetryQueue.length)
  for (const item of batch) {
    try {
      await reinforceMemory(item.entryId, 'access')
    } catch (e) {
      if (item.retries < MAX_REINFORCE_RETRIES) {
        reinforceRetryQueue.push({ entryId: item.entryId, retries: item.retries + 1 })
      } else {
        logger.warn(`Reinforce permanently failed for ${item.entryId} after ${MAX_REINFORCE_RETRIES + 1} attempts: ${e}`)
      }
    }
  }
  if (reinforceRetryQueue.length > 0) {
    setTimeout(processReinforceRetries, 5000)
  } else {
    retryTimerActive = false
  }
}

interface RetrieveOptions {
  maxResults?: number
  projectPath?: string
  tags?: string[]
}

// Backend names and other domain-specific terms get higher match weight
const HIGH_VALUE_KEYWORDS = new Set([
  'iflow', 'opencode', 'codebuddy', 'local', 'openai', 'claude',
  'backend', 'daemon', 'workflow', 'agent', 'memory', 'lark', 'telegram',
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
  // Entry contains query keyword (e.g. query 'iflow' matches entry 'iflow_backend')
  if (ne.includes(nq)) return 0.8
  // Query contains entry keyword (weaker: entry is a substring of query)
  if (nq.includes(ne)) return 0.5

  return 0
}

const RERANK_ORIGINAL_WEIGHT = 0.5
const RERANK_TFIDF_WEIGHT = 0.5

// ── TF-IDF content similarity rerank (no LLM) ──

/** Tokenize text into terms: split on non-word, lowercase, filter short/stop words */
function tokenize(text: string): string[] {
  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'and',
    'but', 'or', 'not', 'no', 'if', 'then', 'else', 'this', 'that',
    'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their', 'we',
    'you', 'he', 'she', 'they', 'me', 'him', 'us', 'them', 'what',
    'which', 'who', 'whom', 'how', 'when', 'where', 'why',
    '的', '是', '了', '在', '有', '和', '与', '或', '不', '也',
    '就', '都', '而', '及', '但', '把', '被', '让', '用', '等',
  ])
  return text
    .toLowerCase()
    .split(/[^\w\u4e00-\u9fff]+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
}

/** Compute term frequency map */
function termFrequency(terms: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1)
  // Normalize by max frequency
  const maxFreq = Math.max(...tf.values(), 1)
  for (const [k, v] of tf) tf.set(k, v / maxFreq)
  return tf
}

/** Compute cosine similarity between query TF and document TF, weighted by IDF */
function tfidfSimilarity(
  queryTf: Map<string, number>,
  docTf: Map<string, number>,
  idf: Map<string, number>,
): number {
  let dotProduct = 0
  let queryNorm = 0
  let docNorm = 0
  for (const [term, qFreq] of queryTf) {
    const idfVal = idf.get(term) ?? 0
    const qWeight = qFreq * idfVal
    const dWeight = (docTf.get(term) ?? 0) * idfVal
    dotProduct += qWeight * dWeight
    queryNorm += qWeight * qWeight
  }
  for (const [term, dFreq] of docTf) {
    const idfVal = idf.get(term) ?? 0
    docNorm += (dFreq * idfVal) ** 2
  }
  const denom = Math.sqrt(queryNorm) * Math.sqrt(docNorm)
  return denom === 0 ? 0 : dotProduct / denom
}

/**
 * TF-IDF rerank: score candidates by content similarity to query.
 * Returns id→score map (0-10). Pure local computation, no LLM.
 */
function rerankMemories(
  query: string,
  candidates: Array<{ entry: MemoryEntry; score: number }>,
): Map<string, number> {
  const queryTerms = tokenize(query)
  if (queryTerms.length === 0) return new Map()

  const queryTf = termFrequency(queryTerms)
  const docTerms = candidates.map(c => tokenize(c.entry.content))

  // Build IDF from candidate documents + query
  const docCount = candidates.length + 1
  const termDocFreq = new Map<string, number>()
  for (const term of queryTf.keys()) termDocFreq.set(term, 1) // query counts as 1 doc
  for (const terms of docTerms) {
    const unique = new Set(terms)
    for (const t of unique) termDocFreq.set(t, (termDocFreq.get(t) ?? 0) + 1)
  }
  const idf = new Map<string, number>()
  for (const [term, df] of termDocFreq) {
    idf.set(term, Math.log(docCount / df) + 1) // smoothed IDF
  }

  const scores = new Map<string, number>()
  for (let i = 0; i < candidates.length; i++) {
    const docTf = termFrequency(docTerms[i]!)
    const sim = tfidfSimilarity(queryTf, docTf, idf)
    scores.set(candidates[i]!.entry.id, sim * 10) // scale to 0-10
  }
  return scores
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
  const filterTags = options?.tags?.map(t => t.trim().toLowerCase()).filter(Boolean)
  const queryKeywords = extractKeywords(query)
  if (queryKeywords.length === 0) return []

  const now = new Date()
  const all = getAllMemories().map(migrateMemoryEntry)

  // Filter out superseded and very weak memories (strength < 10 = effectively forgotten)
  const active = all.filter(entry => !entry.superseded && calculateStrength(entry, now) >= 10)

  // HippoRAG-lite: entity-based retrieval boost
  const entityHits = queryEntityIndex(query)

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
    // Normalize by query keywords count (incl. expanded terms) to prevent
    // score inflation when expanded terms hit on small-keyword entries
    const normalizer = Math.max(queryKeywords.length, 1)
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

    // Entity match boost (HippoRAG-lite): entities like API paths, config keys
    const entityMatchCount = entityHits.get(entry.id) ?? 0
    if (entityMatchCount > 0) {
      score += Math.min(entityMatchCount * 0.5, 1.5)
    }

    // Tag match boost: entries with matching tags get a bonus
    let tagMatch = false
    if (filterTags && filterTags.length > 0 && entry.tags && entry.tags.length > 0) {
      const entryTagSet = new Set(entry.tags)
      const matchCount = filterTags.filter(t => entryTagSet.has(t)).length
      if (matchCount > 0) {
        score += matchCount * 0.4
        tagMatch = true
      }
    }

    return { entry, score, keywordScore: keywordScore + entityMatchCount, tagMatch }
  })

  // Filter out entries with no keyword overlap, sort descending
  // When tags filter is active: exclude entries that have tags but none match
  // (entries without tags are kept for backward compatibility)
  const hasTagFilter = filterTags && filterTags.length > 0
  const config = await loadConfig()
  const rerankConfig = config.memory.rerank
  const candidateSize = rerankConfig.enabled ? rerankConfig.candidateSize : maxResults

  const rankedCandidates = scored
    .filter(s => {
      if (s.keywordScore <= 0) return false
      if (hasTagFilter && s.entry.tags && s.entry.tags.length > 0 && !s.tagMatch) return false
      return true
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, candidateSize)

  // TF-IDF re-rank when enabled and candidates exceed maxResults
  let directResults: MemoryEntry[]
  if (rerankConfig.enabled && candidateSize > maxResults && rankedCandidates.length > maxResults) {
    const tfidfScores = rerankMemories(query, rankedCandidates)
    // Normalize original scores to 0-10
    const maxOrigScore = rankedCandidates[0]?.score ?? 1
    const minOrigScore = rankedCandidates[rankedCandidates.length - 1]?.score ?? 0
    const scoreRange = maxOrigScore - minOrigScore

    const reranked = rankedCandidates.map(c => {
      const normOrig = scoreRange === 0 ? 5 : ((c.score - minOrigScore) / scoreRange) * 10
      const tfidfScore = tfidfScores.get(c.entry.id) ?? normOrig
      const combined = normOrig * RERANK_ORIGINAL_WEIGHT + tfidfScore * RERANK_TFIDF_WEIGHT
      return { entry: c.entry, combined }
    })
    reranked.sort((a, b) => b.combined - a.combined)
    directResults = reranked.slice(0, maxResults).map(r => r.entry)
  } else {
    directResults = rankedCandidates.slice(0, maxResults).map(s => s.entry)
  }

  // Associative expansion: when direct results are insufficient, spread activation
  let results = directResults
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
    // Fire-and-forget reinforcement with retry queue on failure
    reinforceMemory(entry.id, 'access').catch(() => enqueueReinforceRetry(entry.id))
  }

  return results
}

/**
 * Retrieve all memory context (semantic + episodic) for a query.
 *
 * Returns formatted string ready for prompt injection.
 * Episodic memory retrieval (when enabled):
 * - Always retrieves 1-2 most recent episodes as short-term context
 * - When query contains trigger words, retrieves up to 3 query-relevant episodes
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

  // Retrieve episodic memories if enabled
  let episodicContext = ''
  if (config.memory.episodic.enabled) {
    const memoryIds = memories.map(m => m.id)
    const triggered = shouldRetrieveEpisode(query)
    const episodes = retrieveEpisodes({
      query,
      currentMemoryIds: memoryIds,
      limit: triggered ? 3 : 2,
    })
    episodicContext = formatEpisodeContext(episodes)
  }

  // Combine: episodic first, then semantic
  const parts = [episodicContext, semanticContext].filter(Boolean)
  return parts.join('\n\n')
}
