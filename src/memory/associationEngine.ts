/**
 * Association engine — build, spread, and retrieve memories via associations
 *
 * Core capabilities:
 * - buildAssociations: keyword overlap (Jaccard), co-task, temporal proximity
 * - spreadActivation: BFS activation spreading with distance decay
 * - associativeRetrieve: seed + spread hybrid retrieval
 * - updateAssociationStrength: co-access boosting
 * - rebuildAllAssociations: batch rebuild
 */

import { extractKeywords } from '../analysis/index.js'
import { loadConfig } from '../config/loadConfig.js'
import { getAllMemories, saveMemory, getMemory } from '../store/MemoryStore.js'
import { migrateMemoryEntry } from './migrateMemory.js'
import type { MemoryEntry, Association, AssociationType } from './types.js'

// ── Association building ──

function computeJaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a.map(k => k.toLowerCase()))
  const setB = new Set(b.map(k => k.toLowerCase()))
  let intersection = 0
  for (const k of setB) {
    if (setA.has(k)) intersection++
  }
  const union = new Set([...setA, ...setB]).size
  return union > 0 ? intersection / union : 0
}

function buildKeywordAssociations(
  entry: MemoryEntry,
  allEntries: MemoryEntry[],
  overlapThreshold: number,
): Association[] {
  const associations: Association[] = []
  for (const other of allEntries) {
    if (other.id === entry.id) continue
    const overlap = computeJaccard(entry.keywords, other.keywords)
    if (overlap >= overlapThreshold) {
      associations.push({ targetId: other.id, weight: overlap, type: 'keyword' })
    }
  }
  return associations
}

function buildCoTaskAssociations(entry: MemoryEntry, allEntries: MemoryEntry[]): Association[] {
  if (entry.source.type !== 'task' || !entry.source.taskId) return []
  return allEntries
    .filter(e => e.id !== entry.id && e.source.taskId === entry.source.taskId)
    .map(e => ({ targetId: e.id, weight: 0.5, type: 'co-task' as AssociationType }))
}

function buildTemporalAssociations(entry: MemoryEntry, allEntries: MemoryEntry[]): Association[] {
  const entryTime = new Date(entry.createdAt).getTime()
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
  const associations: Association[] = []
  for (const other of allEntries) {
    if (other.id === entry.id) continue
    const timeDiff = Math.abs(new Date(other.createdAt).getTime() - entryTime)
    if (timeDiff <= TWENTY_FOUR_HOURS) {
      // Weight decreases linearly with time distance
      const weight = 0.3 * (1 - timeDiff / TWENTY_FOUR_HOURS)
      if (weight > 0.05) {
        associations.push({ targetId: other.id, weight, type: 'keyword' })
      }
    }
  }
  return associations
}

function mergeAssociations(associations: Association[]): Association[] {
  const byTarget = new Map<string, Association>()
  for (const a of associations) {
    const existing = byTarget.get(a.targetId)
    if (!existing || a.weight > existing.weight) {
      byTarget.set(a.targetId, a)
    }
  }
  return [...byTarget.values()]
}

/**
 * Build associations for an entry against all other entries.
 * Combines keyword overlap, co-task co-occurrence, and temporal proximity.
 */
export async function buildAssociations(
  entry: MemoryEntry,
  allEntries: MemoryEntry[],
): Promise<Association[]> {
  const config = await loadConfig()
  const threshold = config.memory.association.overlapThreshold

  const keyword = buildKeywordAssociations(entry, allEntries, threshold)
  const coTask = buildCoTaskAssociations(entry, allEntries)
  const temporal = buildTemporalAssociations(entry, allEntries)

  return mergeAssociations([...keyword, ...coTask, ...temporal])
}

// ── Activation spreading ──

interface ActivatedEntry {
  entry: MemoryEntry
  activationLevel: number
}

/**
 * BFS activation spreading from a start entry.
 * Activation decays by association weight * 0.5 per hop.
 */
export async function spreadActivation(
  startEntryId: string,
  allEntries: MemoryEntry[],
  depth?: number,
): Promise<ActivatedEntry[]> {
  const config = await loadConfig()
  const maxDepth = depth ?? config.memory.association.maxSpreadDepth

  const entryMap = new Map(allEntries.map(e => [e.id, e]))
  const startEntry = entryMap.get(startEntryId)
  if (!startEntry) return []

  const activated = new Map<string, number>() // id -> activation level
  activated.set(startEntryId, 1.0)

  let frontier: Array<{ id: string; level: number }> = [{ id: startEntryId, level: 1.0 }]

  for (let d = 0; d < maxDepth; d++) {
    const nextFrontier: Array<{ id: string; level: number }> = []
    for (const { id, level } of frontier) {
      const current = entryMap.get(id)
      if (!current?.associations) continue
      for (const assoc of current.associations) {
        if (activated.has(assoc.targetId)) continue
        const target = entryMap.get(assoc.targetId)
        if (!target) continue

        const newLevel = level * assoc.weight * 0.5
        if (newLevel < 0.01) continue // too weak

        activated.set(assoc.targetId, newLevel)
        nextFrontier.push({ id: assoc.targetId, level: newLevel })
      }
    }
    frontier = nextFrontier
    if (frontier.length === 0) break
  }

  // Remove start entry, build result sorted by activation
  activated.delete(startEntryId)
  const results: ActivatedEntry[] = []
  for (const [id, activationLevel] of activated) {
    const entry = entryMap.get(id)
    if (entry) results.push({ entry, activationLevel })
  }
  return results.sort((a, b) => b.activationLevel - a.activationLevel)
}

// ── Association strength update ──

/**
 * Boost bidirectional association strength between two entries.
 * Capped at 1.0.
 */
export function updateAssociationStrength(
  entryId1: string,
  entryId2: string,
  boost: number,
): void {
  const entry1 = getMemory(entryId1)
  const entry2 = getMemory(entryId2)
  if (!entry1 || !entry2) return

  const m1 = migrateMemoryEntry(entry1)
  const m2 = migrateMemoryEntry(entry2)

  boostAssoc(m1, entryId2, boost)
  boostAssoc(m2, entryId1, boost)

  saveMemory(m1)
  saveMemory(m2)
}

function boostAssoc(entry: MemoryEntry, targetId: string, boost: number): void {
  const assocs = entry.associations ?? []
  const existing = assocs.find(a => a.targetId === targetId)
  if (existing) {
    existing.weight = Math.min(existing.weight + boost, 1.0)
  } else {
    assocs.push({ targetId, weight: Math.min(boost, 1.0), type: 'keyword' })
  }
  entry.associations = assocs
}

// ── Associative retrieval ──

/**
 * Hybrid retrieval: keyword seed matching + activation spreading.
 * Score = keywordScore * 0.6 + activationLevel * 0.4, weighted by strength/100.
 */
export async function associativeRetrieve(
  query: string,
  allEntries: MemoryEntry[],
  topK?: number,
): Promise<MemoryEntry[]> {
  const config = await loadConfig()
  const k = topK ?? config.memory.association.maxAssociatedResults

  const queryKeywords = extractKeywords(query)
  if (queryKeywords.length === 0) return []

  // Score all entries by keyword match
  const keywordScores = new Map<string, number>()
  for (const entry of allEntries) {
    const overlap = queryKeywords.filter(qk =>
      entry.keywords.some(ek => ek.toLowerCase().includes(qk.toLowerCase()) || qk.toLowerCase().includes(ek.toLowerCase())),
    ).length
    const score = overlap / queryKeywords.length
    if (score > 0) keywordScores.set(entry.id, score)
  }

  // Find seed entries (top keyword matches)
  const seeds = [...keywordScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  if (seeds.length === 0) return []

  // Spread activation from each seed, collect activation levels
  const activationScores = new Map<string, number>()
  for (const [seedId] of seeds) {
    const activated = await spreadActivation(seedId, allEntries)
    for (const { entry, activationLevel } of activated) {
      const existing = activationScores.get(entry.id) ?? 0
      activationScores.set(entry.id, Math.max(existing, activationLevel))
    }
  }

  // Merge: all entries that have either keyword or activation score
  const candidateIds = new Set([...keywordScores.keys(), ...activationScores.keys()])
  const entryMap = new Map(allEntries.map(e => [e.id, e]))

  const scored: Array<{ entry: MemoryEntry; score: number }> = []
  for (const id of candidateIds) {
    const entry = entryMap.get(id)
    if (!entry) continue
    const kw = keywordScores.get(id) ?? 0
    const act = activationScores.get(id) ?? 0
    const strength = (entry.strength ?? 50) / 100
    const score = (kw * 0.6 + act * 0.4) * strength
    scored.push({ entry, score })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(s => s.entry)
}

// ── Batch rebuild ──

/**
 * Rebuild associations for all memory entries.
 * Returns count of total entries processed and new links created.
 */
export async function rebuildAllAssociations(): Promise<{ total: number; newLinks: number }> {
  const raw = getAllMemories()
  const allEntries = raw.map(migrateMemoryEntry)
  let newLinks = 0

  for (const entry of allEntries) {
    const oldCount = (entry.associations ?? []).length
    entry.associations = await buildAssociations(entry, allEntries)
    newLinks += Math.max(0, entry.associations.length - oldCount)
    saveMemory(entry)
  }

  return { total: allEntries.length, newLinks }
}
