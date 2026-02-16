/**
 * Lazy migration for MemoryEntry — backfill new fields on read
 */

import type { MemoryEntry } from './types.js'

/**
 * Compute initial stability for legacy entries based on accessCount and confidence.
 * More accessed / higher confidence entries get higher stability (slower decay).
 */
function computeInitialStability(entry: MemoryEntry): number {
  const base = 24 // 24 hours baseline
  const accessBonus = Math.min((entry.accessCount ?? 0) * 12, 120) // +12h per access, cap 120h
  const confidenceBonus = (entry.confidence ?? 0.5) * 48 // high confidence up to +48h
  return base + accessBonus + confidenceBonus
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
