/**
 * Tier promotion engine — ranking-based memory promotion/demotion
 *
 * Pure algorithm, 0 LLM calls.
 * Runs periodically to move memories between tiers based on composite score.
 */

import { loadConfig } from '../config/loadConfig.js'
import { getAllMemories, atomicUpdateMemory } from '../store/MemoryStore.js'
import { migrateMemoryEntry } from './migrateMemory.js'
import type { MemoryEntry, MemoryTier } from './types.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('tier-promotion')

/**
 * Compute promotion score for a memory entry.
 *
 * score = accessFrequency × recency × importance × (1 + valence.intensity × 0.5)
 * Emotional boost: valence.intensity > 0.8 → score × 2
 */
export function computePromotionScore(entry: MemoryEntry, now?: Date): number {
  const currentTime = now ?? new Date()

  const accessFrequency = Math.log(1 + (entry.accessCount ?? 0))

  const lastAccess = entry.lastAccessedAt ?? entry.updatedAt ?? entry.createdAt
  const hoursSinceLastAccess = (currentTime.getTime() - new Date(lastAccess).getTime()) / 3600000
  const recency = 1 / (1 + Math.max(0, hoursSinceLastAccess) / 24)

  const importance = entry.importance ?? 5

  const intensity = entry.valence?.intensity ?? 0
  let score = accessFrequency * recency * importance * (1 + intensity * 0.5)

  // Emotional acceleration channel
  if (intensity > 0.8) score *= 2

  return score
}

interface PromotionResult {
  promoted: number
  demoted: number
  archived: number
}

/**
 * Run tier promotion/demotion cycle.
 *
 * - hot → longterm: age > 2h, by score desc, fill longterm vacancies
 * - longterm → permanent: accessCount >= 3, by score desc, fill permanent vacancies
 * - permanent overflow: lowest score demoted to longterm
 * - longterm overflow: lowest score archived (tier removed / strength zeroed)
 */
export async function runTierPromotion(): Promise<PromotionResult> {
  const config = await loadConfig()
  const { maxPermanent, maxLongterm, maxHot } = config.memory.tiers
  const now = new Date()

  const allRaw = getAllMemories()
  const all = allRaw.map(migrateMemoryEntry)

  // Bucket by tier
  const permanent: Array<MemoryEntry & { _score: number }> = []
  const longterm: Array<MemoryEntry & { _score: number }> = []
  const hot: Array<MemoryEntry & { _score: number }> = []

  for (const entry of all) {
    const scored = { ...entry, _score: computePromotionScore(entry, now) }
    const tier: MemoryTier = entry.tier ?? 'longterm'
    if (tier === 'permanent') permanent.push(scored)
    else if (tier === 'hot') hot.push(scored)
    else longterm.push(scored)
  }

  let promoted = 0
  let demoted = 0
  let archived = 0

  // --- hot → longterm promotion ---
  const twoHoursAgo = now.getTime() - 2 * 3600000
  const hotCandidates = hot
    .filter(e => new Date(e.createdAt).getTime() < twoHoursAgo)
    .sort((a, b) => b._score - a._score)

  const longtermVacancy = Math.max(0, maxLongterm - longterm.length)
  const hotToPromote = hotCandidates.slice(0, longtermVacancy)

  for (const entry of hotToPromote) {
    atomicUpdateMemory(entry.id, () => ({ tier: 'longterm' as MemoryTier }))
    promoted++
    // Move to longterm bucket for overflow check
    longterm.push(entry)
    const idx = hot.indexOf(entry)
    if (idx !== -1) hot.splice(idx, 1)
  }

  // --- longterm → permanent promotion ---
  const longtermCandidates = longterm
    .filter(e => (e.accessCount ?? 0) >= 3)
    .sort((a, b) => b._score - a._score)

  const permanentVacancy = Math.max(0, maxPermanent - permanent.length)
  const ltToPromote = longtermCandidates.slice(0, permanentVacancy)

  for (const entry of ltToPromote) {
    atomicUpdateMemory(entry.id, () => ({ tier: 'permanent' as MemoryTier }))
    promoted++
    permanent.push(entry)
    const idx = longterm.indexOf(entry)
    if (idx !== -1) longterm.splice(idx, 1)
  }

  // --- permanent overflow → demote lowest to longterm ---
  if (permanent.length > maxPermanent) {
    permanent.sort((a, b) => a._score - b._score) // ascending, lowest first
    const toRemove = permanent.splice(0, permanent.length - maxPermanent)
    for (const entry of toRemove) {
      atomicUpdateMemory(entry.id, () => ({ tier: 'longterm' as MemoryTier }))
      demoted++
      longterm.push(entry)
    }
  }

  // --- longterm overflow → archive lowest (zero strength, forgettingEngine will clean up) ---
  if (longterm.length > maxLongterm) {
    longterm.sort((a, b) => a._score - b._score)
    const toArchive = longterm.splice(0, longterm.length - maxLongterm)
    for (const entry of toArchive) {
      atomicUpdateMemory(entry.id, () => ({ strength: 0 }))
      archived++
    }
  }

  if (promoted > 0 || demoted > 0 || archived > 0) {
    logger.info(`Tier promotion: promoted=${promoted}, demoted=${demoted}, archived=${archived}`)
  }

  return { promoted, demoted, archived }
}
