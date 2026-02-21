/**
 * Lazy migration for MemoryEntry — backfill new fields on read
 */

import type { MemoryEntry } from './types.js'

/**
 * Compute initial stability for legacy entries.
 * Uses confidence as primary signal. Access count has minimal impact
 * since it only means "was retrieved", not "was valuable".
 */
function computeInitialStability(entry: MemoryEntry): number {
  const base = 72 // 72 hours baseline — generous for existing entries surviving migration
  const confidenceBonus = (entry.confidence ?? 0.5) * 96 // high confidence up to +96h
  const accessBonus = Math.min((entry.accessCount ?? 0) * 2, 24) // +2h per access, cap 24h (minor)
  return base + confidenceBonus + accessBonus
}

/**
 * Migrate a MemoryEntry by filling in missing fields with sensible defaults.
 * Called on read — if any new field is missing, backfill it.
 * Returns the entry unchanged if already migrated (no allocation).
 */
export function migrateMemoryEntry(entry: MemoryEntry): MemoryEntry {
  // Fast path: if strength exists, assume fully migrated
  if (entry.strength !== undefined) return entry

  return {
    ...entry,
    strength: 50,
    stability: computeInitialStability(entry),
    lastReinforcedAt: entry.updatedAt ?? entry.createdAt,
    reinforceCount: 0,
    decayRate: 1.0,
    associations: [],
  }
}

/**
 * Check if a MemoryEntry needs migration (missing new fields).
 */
export function needsMigration(entry: MemoryEntry): boolean {
  return entry.strength === undefined
}
