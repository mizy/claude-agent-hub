/**
 * Tests for Phase 1: Memory tier infrastructure
 * - calculateStrength tier-aware behavior
 * - migrateMemoryEntry tier backfill
 */

import { describe, it, expect } from 'vitest'
import { calculateStrength } from '../src/memory/forgettingEngine.js'
import { migrateMemoryEntry, needsMigration } from '../src/memory/migrateMemory.js'
import type { MemoryEntry } from '../src/memory/types.js'

function makeEntry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
  const now = new Date().toISOString()
  return {
    content: 'test content',
    category: 'pattern',
    keywords: ['test'],
    source: { type: 'manual' },
    confidence: 0.8,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    strength: 100,
    stability: 168,
    decayRate: 1.0,
    lastReinforcedAt: now,
    reinforceCount: 0,
    associations: [],
    tier: 'longterm',
    ...overrides,
  }
}

describe('calculateStrength tier behavior', () => {
  it('permanent tier always returns 100', () => {
    const entry = makeEntry({
      id: 'perm-1',
      tier: 'permanent',
      lastReinforcedAt: new Date(Date.now() - 365 * 24 * 3600000).toISOString(),
    })
    expect(calculateStrength(entry)).toBe(100)
  })

  it('hot tier decays faster than longterm', () => {
    const baseTime = new Date('2026-01-01T00:00:00Z')
    const now = new Date('2026-01-02T00:00:00Z') // 24h later

    const hotEntry = makeEntry({
      id: 'hot-1',
      tier: 'hot',
      stability: 168,
      decayRate: 1.0,
      lastReinforcedAt: baseTime.toISOString(),
    })
    const longtermEntry = makeEntry({
      id: 'lt-1',
      tier: 'longterm',
      stability: 168,
      decayRate: 1.0,
      lastReinforcedAt: baseTime.toISOString(),
    })

    const hotStrength = calculateStrength(hotEntry, now)
    const ltStrength = calculateStrength(longtermEntry, now)

    expect(hotStrength).toBeLessThan(ltStrength)
  })

  it('longterm tier decays normally', () => {
    const baseTime = new Date('2026-01-01T00:00:00Z')
    const now = new Date('2026-01-08T00:00:00Z') // 168h later

    const entry = makeEntry({
      id: 'lt-2',
      tier: 'longterm',
      stability: 168,
      decayRate: 1.0,
      lastReinforcedAt: baseTime.toISOString(),
    })

    const strength = calculateStrength(entry, now)
    // e^(-168/168) = e^(-1) ≈ 0.368 → 37
    expect(strength).toBe(37)
  })
})

describe('migrateMemoryEntry tier backfill', () => {
  it('backfills tier to longterm when missing', () => {
    const entry = makeEntry({ id: 'migrate-1' })
    delete (entry as Record<string, unknown>).tier

    const migrated = migrateMemoryEntry(entry)
    expect(migrated.tier).toBe('longterm')
  })

  it('preserves existing tier value', () => {
    const entry = makeEntry({ id: 'migrate-2', tier: 'hot' })
    const migrated = migrateMemoryEntry(entry)
    expect(migrated.tier).toBe('hot')
  })

  it('needsMigration detects missing tier', () => {
    const entry = makeEntry({ id: 'migrate-3' })
    expect(needsMigration(entry)).toBe(false)

    delete (entry as Record<string, unknown>).tier
    expect(needsMigration(entry)).toBe(true)
  })
})
