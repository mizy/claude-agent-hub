/**
 * A-MEM inspired memory consolidation — find and merge duplicate/similar memories
 *
 * Periodically scans for high-similarity memory pairs and uses LLM to decide:
 * - merge: combine content into one entry, delete the other
 * - supersede: newer entry replaces older, delete old
 * - keep: both are distinct, leave as-is
 *
 * Triggered after task memory extraction when new memories >= threshold.
 */

import { invokeBackend, resolveLightModel } from '../backend/index.js'
import { getAllMemories, saveMemory, deleteMemory, updateMemory } from '../store/MemoryStore.js'
import { migrateMemoryEntry } from './migrateMemory.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { MemoryEntry } from './types.js'

const logger = createLogger('memory-consolidate')

// Min similarity to consider a pair for consolidation
const SIMILARITY_THRESHOLD = 0.6
// Max pairs to send to LLM in one batch
const MAX_PAIRS_PER_BATCH = 5
// Min new memories to trigger consolidation
const MIN_NEW_MEMORIES_TO_TRIGGER = 3

/** CJK character test */
function isCJK(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)
}

/** Tokenize for similarity: space-split words + CJK 2-grams */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
  const lower = text.toLowerCase()
  for (const w of lower.split(/\s+/)) {
    if (w.length >= 2) tokens.add(w)
  }
  for (let i = 0; i < lower.length - 1; i++) {
    if (isCJK(lower[i]!) && isCJK(lower[i + 1]!)) {
      tokens.add(lower[i]! + lower[i + 1]!)
    }
  }
  return tokens
}

/** Token-based content similarity (Jaccard-like) */
function contentSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a)
  const tokensB = tokenize(b)
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let overlap = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++
  }
  return overlap / Math.max(tokensA.size, tokensB.size)
}

interface SimilarPair {
  a: MemoryEntry
  b: MemoryEntry
  similarity: number
}

/** Find memory pairs above similarity threshold */
function findSimilarPairs(memories: MemoryEntry[]): SimilarPair[] {
  const pairs: SimilarPair[] = []
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const sim = contentSimilarity(memories[i]!.content, memories[j]!.content)
      if (sim >= SIMILARITY_THRESHOLD) {
        pairs.push({ a: memories[i]!, b: memories[j]!, similarity: sim })
      }
    }
  }
  // Sort by similarity descending — most similar first
  return pairs.sort((x, y) => y.similarity - x.similarity)
}

type ConsolidationDecision = 'merge' | 'supersede_a' | 'supersede_b' | 'keep'

interface PairDecision {
  pairIndex: number
  decision: ConsolidationDecision
  mergedContent?: string
  mergedKeywords?: string[]
}

function buildConsolidationPrompt(pairs: SimilarPair[]): string {
  const pairsText = pairs.map((p, i) => `
## Pair ${i}
**Memory A** [${p.a.category}] (confidence: ${p.a.confidence}, keywords: ${p.a.keywords.join(', ')})
${p.a.content}

**Memory B** [${p.b.category}] (confidence: ${p.b.confidence}, keywords: ${p.b.keywords.join(', ')})
${p.b.content}

Similarity: ${(p.similarity * 100).toFixed(0)}%
`).join('\n---\n')

  return `You are a memory consolidation agent. Analyze the following similar memory pairs and decide how to handle each.

${pairsText}

For each pair, decide:
- **merge**: The memories cover the same topic. Combine into one comprehensive entry.
- **supersede_a**: Memory A is a newer/better version. Keep A, discard B.
- **supersede_b**: Memory B is a newer/better version. Keep B, discard A.
- **keep**: Despite similarity, they cover distinct aspects. Keep both.

Return a JSON array:
[
  {
    "pairIndex": 0,
    "decision": "merge|supersede_a|supersede_b|keep",
    "mergedContent": "...(only for merge decision, combined content in 1-3 sentences)",
    "mergedKeywords": ["...(only for merge, union of important keywords)"]
  }
]

Only return JSON, no other text.`
}

function parseDecisions(text: string): PairDecision[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((d: PairDecision) =>
      typeof d.pairIndex === 'number' &&
      ['merge', 'supersede_a', 'supersede_b', 'keep'].includes(d.decision),
    )
  } catch {
    return []
  }
}

/** Apply a single consolidation decision */
function applyDecision(pair: SimilarPair, decision: PairDecision): { merged: number; deleted: number } {
  const now = new Date().toISOString()

  switch (decision.decision) {
    case 'merge': {
      // Update A with merged content, delete B
      const mergedKeywords = decision.mergedKeywords ??
        [...new Set([...pair.a.keywords, ...pair.b.keywords])]
      updateMemory(pair.a.id, {
        content: decision.mergedContent ?? pair.a.content,
        keywords: mergedKeywords,
        confidence: Math.max(pair.a.confidence, pair.b.confidence),
        reinforceCount: (pair.a.reinforceCount ?? 0) + (pair.b.reinforceCount ?? 0),
        updatedAt: now,
      })
      // Migrate B's associations to A
      migrateAssociations(pair.b, pair.a)
      deleteMemory(pair.b.id)
      return { merged: 1, deleted: 1 }
    }
    case 'supersede_a': {
      migrateAssociations(pair.b, pair.a)
      deleteMemory(pair.b.id)
      return { merged: 0, deleted: 1 }
    }
    case 'supersede_b': {
      migrateAssociations(pair.a, pair.b)
      deleteMemory(pair.a.id)
      return { merged: 0, deleted: 1 }
    }
    case 'keep':
    default:
      return { merged: 0, deleted: 0 }
  }
}

/** Move associations from deleted entry to surviving entry */
function migrateAssociations(deleted: MemoryEntry, survivor: MemoryEntry): void {
  if (!deleted.associations || deleted.associations.length === 0) return

  const existingTargets = new Set((survivor.associations ?? []).map(a => a.targetId))
  const newAssocs = deleted.associations.filter(
    a => a.targetId !== survivor.id && !existingTargets.has(a.targetId),
  )

  if (newAssocs.length > 0) {
    const updated = [...(survivor.associations ?? []), ...newAssocs]
    saveMemory({ ...survivor, associations: updated })
  }
}

export interface ConsolidationResult {
  pairsFound: number
  pairsProcessed: number
  merged: number
  deleted: number
  kept: number
}

/**
 * Main consolidation entry point.
 * Scans all memories for similar pairs, asks LLM to decide, applies decisions.
 */
export async function consolidateMemories(): Promise<ConsolidationResult> {
  const result: ConsolidationResult = { pairsFound: 0, pairsProcessed: 0, merged: 0, deleted: 0, kept: 0 }

  try {
    const all = getAllMemories().map(migrateMemoryEntry)
    const pairs = findSimilarPairs(all)
    result.pairsFound = pairs.length

    if (pairs.length === 0) {
      logger.info('No similar memory pairs found for consolidation')
      return result
    }

    // Take top N pairs for this batch
    const batch = pairs.slice(0, MAX_PAIRS_PER_BATCH)
    const prompt = buildConsolidationPrompt(batch)

    const lightModel = await resolveLightModel()
    const llmResult = await invokeBackend({
      prompt,
      mode: 'review',
      model: lightModel,
      disableMcp: true,
      timeoutMs: 60_000,
    })

    if (!llmResult.ok) {
      logger.warn(`Consolidation LLM call failed: ${llmResult.error.message}`)
      return result
    }

    const decisions = parseDecisions(llmResult.value.response)

    // Track deleted IDs to avoid double-processing
    const deletedIds = new Set<string>()

    for (const decision of decisions) {
      const pair = batch[decision.pairIndex]
      if (!pair) continue
      if (deletedIds.has(pair.a.id) || deletedIds.has(pair.b.id)) continue

      const applied = applyDecision(pair, decision)
      result.merged += applied.merged
      result.deleted += applied.deleted
      if (decision.decision === 'keep') result.kept++
      result.pairsProcessed++

      if (applied.deleted > 0) {
        if (decision.decision === 'supersede_b' || decision.decision === 'merge') {
          // For merge: B was deleted. For supersede_b: A was deleted
          deletedIds.add(decision.decision === 'supersede_b' ? pair.a.id : pair.b.id)
        } else if (decision.decision === 'supersede_a') {
          deletedIds.add(pair.b.id)
        }
      }
    }

    logger.info(`Consolidation complete: ${result.pairsProcessed} pairs processed, ${result.merged} merged, ${result.deleted} deleted, ${result.kept} kept`)
    return result
  } catch (error) {
    logger.warn(`Memory consolidation failed: ${getErrorMessage(error)}`)
    return result
  }
}

/**
 * Check if consolidation should run based on number of new memories.
 * Call this after extractMemoryFromTask / extractChatMemory.
 */
export function shouldConsolidate(newMemoryCount: number): boolean {
  return newMemoryCount >= MIN_NEW_MEMORIES_TO_TRIGGER
}
