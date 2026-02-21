/**
 * Forgetting engine — Ebbinghaus-based memory strength decay and reinforcement
 *
 * Core formula: R = e^(-t/S) where t = hours since last reinforcement, S = effective stability
 */

import { loadConfig } from '../config/loadConfig.js'
import {
  getAllMemories,
  getMemory,
  updateMemory,
  deleteMemory as deleteMemoryFromStore,
} from '../store/MemoryStore.js'
import { migrateMemoryEntry } from './migrateMemory.js'
import type { MemoryEntry } from './types.js'

type ReinforceReason = 'access' | 'task_success' | 'task_failure' | 'manual'

// Map reason to config key for stability multiplier
const REASON_TO_CONFIG_KEY: Record<ReinforceReason, string> = {
  access: 'retrieve',
  task_success: 'taskSuccess',
  task_failure: 'taskFailure',
  manual: 'manualReview',
}

/**
 * Calculate current memory strength based on Ebbinghaus forgetting curve.
 * Pure function — no side effects.
 *
 * R = e^(-t / effectiveStability) * 100
 * effectiveStability = stability / decayRate
 */
export function calculateStrength(entry: MemoryEntry, now?: Date): number {
  const migrated = migrateMemoryEntry(entry)
  const currentTime = now ?? new Date()
  const lastReinforced = new Date(migrated.lastReinforcedAt!).getTime()
  const hoursSinceReinforce = (currentTime.getTime() - lastReinforced) / 3600000

  if (hoursSinceReinforce <= 0) return 100

  const effectiveStability = migrated.stability! / migrated.decayRate!
  const retention = Math.exp(-hoursSinceReinforce / effectiveStability)
  return Math.round(retention * 100)
}

/**
 * Reinforce a memory entry after meaningful use.
 * Updates stability, reinforceCount, lastReinforcedAt, and decayRate.
 */
export async function reinforceMemory(
  entryId: string,
  reason: ReinforceReason,
): Promise<MemoryEntry | null> {
  const raw = getMemory(entryId)
  if (!raw) return null

  const entry = migrateMemoryEntry(raw)
  const config = await loadConfig()
  const reinforceConfig = config.memory.reinforce
  const forgettingConfig = config.memory.forgetting

  // Get stability multiplier from config
  const configKey = REASON_TO_CONFIG_KEY[reason]
  const multiplier = (reinforceConfig as Record<string, number>)[configKey] ?? 1.0

  // Update stability (capped at maxStability)
  // Note: even at maxStability, reinforcement still resets lastReinforcedAt (below),
  // which effectively restarts the decay clock — so reinforcement is always beneficial.
  // For task_failure (multiplier < 1), stability decreases but lastReinforcedAt still resets.
  const newStability = Math.min(
    entry.stability! * multiplier,
    forgettingConfig.maxStability,
  )

  // Update reinforceCount
  const newReinforceCount = (entry.reinforceCount ?? 0) + 1

  // Recompute decayRate based on confidence and reinforcement history
  const newDecayRate = computeDecayRate(entry.confidence, newReinforceCount, entry.category)

  const now = new Date().toISOString()

  // Build the updated entry first, then compute strength from it
  // (strength depends on stability, lastReinforcedAt, decayRate — all changing)
  const updated: MemoryEntry = {
    ...entry,
    stability: newStability,
    reinforceCount: newReinforceCount,
    lastReinforcedAt: now,
    decayRate: newDecayRate,
  }
  updated.strength = calculateStrength(updated)

  updateMemory(entryId, {
    strength: updated.strength,
    stability: newStability,
    reinforceCount: newReinforceCount,
    lastReinforcedAt: now,
    decayRate: newDecayRate,
  })

  return updated
}

/**
 * Compute decay rate based on confidence, reinforce count, and category.
 * Higher confidence + more reinforcements = slower decay (lower rate).
 */
function computeDecayRate(confidence: number, reinforceCount: number, category: string): number {
  let rate = 1.0
  if (confidence >= 0.8) rate *= 0.7
  if (reinforceCount >= 5) rate *= 0.8
  if (category === 'pitfall') rate *= 0.9
  return Math.max(rate, 0.5)
}

/**
 * Clean up fading memories — archive weak ones, delete very weak ones.
 * Returns count of archived and deleted entries.
 */
export async function cleanupFadingMemories(): Promise<{ archived: number; deleted: number }> {
  const config = await loadConfig()
  const { archiveThreshold, deleteThreshold, enabled } = config.memory.forgetting

  if (!enabled) return { archived: 0, deleted: 0 }

  const all = getAllMemories()
  const now = new Date()
  let archived = 0
  let deleted = 0

  for (const raw of all) {
    const entry = migrateMemoryEntry(raw)
    const strength = calculateStrength(entry, now)

    if (strength < deleteThreshold) {
      deleteMemoryFromStore(entry.id)
      deleted++
    } else if (strength < archiveThreshold) {
      // Archive by setting strength to 0 and marking category
      // We keep the entry but it won't appear in normal retrieval
      updateMemory(entry.id, {
        strength: 0,
        updatedAt: now.toISOString(),
      })
      archived++
    }
  }

  return { archived, deleted }
}

/**
 * Get health status of all memories — current strength and estimated days until fade.
 */
export async function getMemoryHealth(): Promise<
  Array<{ id: string; title: string; strength: number; daysUntilFade: number }>
> {
  const config = await loadConfig()
  const { archiveThreshold } = config.memory.forgetting

  const all = getAllMemories()
  const now = new Date()

  return all.map(raw => {
    const entry = migrateMemoryEntry(raw)
    const strength = calculateStrength(entry, now)

    // Estimate days until strength drops below archiveThreshold
    // From R = e^(-t/S), solve for t when R = threshold/100:
    // t = -S * ln(threshold/100)
    const effectiveStability = entry.stability! / entry.decayRate!
    const thresholdRatio = archiveThreshold / 100
    let daysUntilFade: number

    if (strength <= archiveThreshold) {
      daysUntilFade = 0
    } else {
      // Hours from lastReinforcedAt until fade
      const hoursUntilFade = -effectiveStability * Math.log(thresholdRatio)
      // Subtract hours already elapsed
      const hoursElapsed =
        (now.getTime() - new Date(entry.lastReinforcedAt!).getTime()) / 3600000
      const hoursRemaining = hoursUntilFade - hoursElapsed
      daysUntilFade = Math.max(0, Math.round((hoursRemaining / 24) * 10) / 10)
    }

    // Use first line of content as title (truncated)
    const title = (entry.content.split('\n')[0] ?? '').slice(0, 60)

    return { id: entry.id, title, strength, daysUntilFade }
  })
}
