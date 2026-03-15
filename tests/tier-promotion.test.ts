/**
 * Tests for Phase 4: Tier promotion engine
 * - computePromotionScore formula
 * - Emotional acceleration channel
 * - hot→longterm promotion
 * - Layer overflow demotion/archival
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computePromotionScore } from '../src/memory/tierPromotion.js'
import type { MemoryEntry, MemoryTier } from '../src/memory/types.js'

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
    importance: 5,
    ...overrides,
  }
}

describe('computePromotionScore', () => {
  const now = new Date('2026-03-13T12:00:00Z')

  it('should return higher score for more accessed memories', () => {
    const low = makeEntry({ id: 'low', accessCount: 1, lastAccessedAt: now.toISOString() })
    const high = makeEntry({ id: 'high', accessCount: 10, lastAccessedAt: now.toISOString() })
    expect(computePromotionScore(high, now)).toBeGreaterThan(computePromotionScore(low, now))
  })

  it('should return higher score for recently accessed memories', () => {
    const recent = makeEntry({
      id: 'recent',
      accessCount: 5,
      lastAccessedAt: now.toISOString(),
    })
    const old = makeEntry({
      id: 'old',
      accessCount: 5,
      lastAccessedAt: new Date(now.getTime() - 7 * 24 * 3600000).toISOString(),
    })
    expect(computePromotionScore(recent, now)).toBeGreaterThan(computePromotionScore(old, now))
  })

  it('should return higher score for more important memories', () => {
    const low = makeEntry({ id: 'low', importance: 2, accessCount: 3, lastAccessedAt: now.toISOString() })
    const high = makeEntry({ id: 'high', importance: 9, accessCount: 3, lastAccessedAt: now.toISOString() })
    expect(computePromotionScore(high, now)).toBeGreaterThan(computePromotionScore(low, now))
  })

  it('should apply emotional boost when intensity > 0.8', () => {
    const base = makeEntry({
      id: 'base',
      accessCount: 5,
      importance: 5,
      lastAccessedAt: now.toISOString(),
    })
    const emotional = makeEntry({
      id: 'emotional',
      accessCount: 5,
      importance: 5,
      lastAccessedAt: now.toISOString(),
      valence: { polarity: 'positive', intensity: 0.9, triggers: ['breakthrough'] },
    })

    const baseScore = computePromotionScore(base, now)
    const emotionalScore = computePromotionScore(emotional, now)

    // Without emotional boost: score * (1 + 0.9 * 0.5) = score * 1.45
    // With emotional boost (intensity > 0.8): above * 2
    // So emotional should be ~2.9x base
    expect(emotionalScore).toBeGreaterThan(baseScore * 2.5)
  })

  it('should NOT apply emotional boost when intensity <= 0.8', () => {
    const base = makeEntry({
      id: 'base',
      accessCount: 5,
      importance: 5,
      lastAccessedAt: now.toISOString(),
    })
    const mild = makeEntry({
      id: 'mild',
      accessCount: 5,
      importance: 5,
      lastAccessedAt: now.toISOString(),
      valence: { polarity: 'positive', intensity: 0.5, triggers: ['collaboration'] },
    })

    const baseScore = computePromotionScore(base, now)
    const mildScore = computePromotionScore(mild, now)

    // mild = base * (1 + 0.5 * 0.5) = base * 1.25
    expect(mildScore / baseScore).toBeCloseTo(1.25, 1)
  })

  it('should handle zero accessCount gracefully', () => {
    const entry = makeEntry({ id: 'zero', accessCount: 0, lastAccessedAt: now.toISOString() })
    expect(computePromotionScore(entry, now)).toBe(0) // log(1+0) = 0
  })
})

describe('runTierPromotion', () => {
  let mockGetAll: ReturnType<typeof vi.fn>
  let mockAtomicUpdate: ReturnType<typeof vi.fn>
  let mockLoadConfig: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()

    mockGetAll = vi.fn().mockReturnValue([])
    mockAtomicUpdate = vi.fn().mockReturnValue(true)
    mockLoadConfig = vi.fn().mockResolvedValue({
      memory: {
        tiers: { maxPermanent: 3, maxLongterm: 5, maxHot: 10 },
        consolidation: { intervalMs: 3600000 },
      },
    })

    vi.doMock('../src/store/MemoryStore.js', () => ({
      getAllMemories: mockGetAll,
      atomicUpdateMemory: mockAtomicUpdate,
    }))
    vi.doMock('../src/config/loadConfig.js', () => ({
      loadConfig: mockLoadConfig,
    }))
    vi.doMock('../src/memory/migrateMemory.js', () => ({
      migrateMemoryEntry: (e: MemoryEntry) => e,
    }))
    vi.doMock('../src/shared/logger.js', () => ({
      createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('should promote hot memories older than 2h to longterm', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString()
    const entries = [
      makeEntry({ id: 'hot1', tier: 'hot', createdAt: threeHoursAgo, accessCount: 2, lastAccessedAt: new Date().toISOString(), importance: 8 }),
      makeEntry({ id: 'hot2', tier: 'hot', createdAt: new Date().toISOString(), accessCount: 5, lastAccessedAt: new Date().toISOString() }), // too young
    ]
    mockGetAll.mockReturnValue(entries)

    const { runTierPromotion } = await import('../src/memory/tierPromotion.js')
    const result = await runTierPromotion()

    expect(result.promoted).toBe(1)
    // Check that hot1 was promoted, not hot2
    expect(mockAtomicUpdate).toHaveBeenCalledWith('hot1', expect.any(Function))
    expect(mockAtomicUpdate).not.toHaveBeenCalledWith('hot2', expect.any(Function))
  })

  it('should promote longterm memories with accessCount >= 3 to permanent', async () => {
    const entries = [
      makeEntry({ id: 'lt1', tier: 'longterm', accessCount: 5, importance: 8, lastAccessedAt: new Date().toISOString() }),
      makeEntry({ id: 'lt2', tier: 'longterm', accessCount: 1, importance: 8, lastAccessedAt: new Date().toISOString() }), // not enough access
    ]
    mockGetAll.mockReturnValue(entries)

    const { runTierPromotion } = await import('../src/memory/tierPromotion.js')
    const result = await runTierPromotion()

    expect(result.promoted).toBe(1)
    expect(mockAtomicUpdate).toHaveBeenCalledWith('lt1', expect.any(Function))
  })

  it('should NOT demote permanent entries when over capacity (permanent = never forget)', async () => {
    // 4 permanent entries, capacity is 3 — should only warn, not demote
    const entries = [
      makeEntry({ id: 'p1', tier: 'permanent', accessCount: 10, importance: 9, lastAccessedAt: new Date().toISOString() }),
      makeEntry({ id: 'p2', tier: 'permanent', accessCount: 8, importance: 8, lastAccessedAt: new Date().toISOString() }),
      makeEntry({ id: 'p3', tier: 'permanent', accessCount: 6, importance: 7, lastAccessedAt: new Date().toISOString() }),
      makeEntry({ id: 'p4', tier: 'permanent', accessCount: 1, importance: 2, lastAccessedAt: new Date().toISOString() }),
    ]
    mockGetAll.mockReturnValue(entries)

    const { runTierPromotion } = await import('../src/memory/tierPromotion.js')
    const result = await runTierPromotion()

    expect(result.demoted).toBe(0)
    // No atomicUpdate calls for demotion
    expect(mockAtomicUpdate).not.toHaveBeenCalled()
  })

  it('should archive lowest-scoring longterm when over capacity', async () => {
    // 6 longterm entries, capacity is 5
    const entries = Array.from({ length: 6 }, (_, i) =>
      makeEntry({
        id: `lt${i}`,
        tier: 'longterm',
        accessCount: i === 0 ? 1 : 2, // lt0 has lowest access
        importance: i === 0 ? 1 : 5,
        lastAccessedAt: new Date().toISOString(),
      })
    )
    mockGetAll.mockReturnValue(entries)

    const { runTierPromotion } = await import('../src/memory/tierPromotion.js')
    const result = await runTierPromotion()

    expect(result.archived).toBe(1)
    // lt0 has lowest score, should be archived
    expect(mockAtomicUpdate).toHaveBeenCalledWith('lt0', expect.any(Function))
  })
})
