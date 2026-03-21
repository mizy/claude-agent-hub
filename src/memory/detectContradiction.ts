/**
 * Detect contradictions between new memory and existing memories
 *
 * Uses keyword overlap to find highly similar existing memories.
 * When overlap exceeds threshold, assumes the new memory supersedes the old one.
 * No LLM call — pure local computation.
 */

import { searchMemories, markSuperseded } from './manageMemory.js'
import { createLogger } from '../shared/logger.js'
import type { MemoryEntry } from './types.js'

const logger = createLogger('memory-contradiction')

/** Minimum keyword overlap ratio to consider two memories as covering the same topic */
const OVERLAP_THRESHOLD = 0.6

/** Compute Jaccard similarity between two keyword sets */
function keywordOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a.map(k => k.toLowerCase()))
  const setB = new Set(b.map(k => k.toLowerCase()))
  let intersection = 0
  for (const k of setA) {
    if (setB.has(k)) intersection++
  }
  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : intersection / union
}

/**
 * Check if new memory content overlaps with existing memories.
 * If high keyword overlap found, marks old memories as superseded.
 * Returns the IDs of superseded memories (empty if none).
 */
export function resolveContradictions(
  newContent: string,
  keywords: string[],
): string[] {
  try {
    const searchQuery = [newContent, ...keywords].join(' ')
    const related = searchMemories(searchQuery)
      .filter(m => !m.superseded)
      .slice(0, 10)

    if (related.length === 0) return []

    const superseded: string[] = []

    for (const existing of related) {
      const overlap = keywordOverlap(keywords, existing.keywords ?? [])
      if (overlap >= OVERLAP_THRESHOLD) {
        markSuperseded(existing.id)
        logger.info(`Superseded memory ${existing.id} (overlap=${overlap.toFixed(2)}): "${existing.content.slice(0, 60)}"`)
        superseded.push(existing.id)
      }
    }

    return superseded
  } catch (error) {
    logger.warn(`Contradiction resolution error: ${error}`)
    return []
  }
}
