import { describe, it, expect, beforeEach } from 'vitest'
import { calculateStrength, reinforceMemory, cleanupFadingMemories, getMemoryHealth } from '../forgettingEngine.js'
import { migrateMemoryEntry } from '../migrateMemory.js'
import { addMemory, removeMemory } from '../manageMemory.js'
import { getAllMemories, getMemory, saveMemory } from '../../store/MemoryStore.js'
import type { MemoryEntry, MemorySource } from '../types.js'

const source: MemorySource = { type: 'task', taskId: 'test-task' }

function clearAll() {
  for (const m of getAllMemories()) {
    removeMemory(m.id)
  }
}

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = new Date().toISOString()
  return {
    id: 'test-1',
    content: 'test memory',
    category: 'lesson',
    keywords: ['test'],
    source,
    confidence: 0.5,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    strength: 100,
    stability: 24,
    lastReinforcedAt: now,
    reinforceCount: 0,
    decayRate: 1.0,
    associations: [],
    ...overrides,
  }
}

describe('calculateStrength', () => {
  it('returns 100 for freshly created memory', () => {
    const entry = makeEntry()
    expect(calculateStrength(entry)).toBe(100)
  })

  it('returns 100 when now equals lastReinforcedAt', () => {
    const now = new Date()
    const entry = makeEntry({ lastReinforcedAt: now.toISOString() })
    expect(calculateStrength(entry, now)).toBe(100)
  })

  it('decays after 1 day (24h stability)', () => {
    const created = new Date('2025-01-01T00:00:00Z')
    const oneDay = new Date('2025-01-02T00:00:00Z')
    const entry = makeEntry({ lastReinforcedAt: created.toISOString(), stability: 24, decayRate: 1.0 })
    const strength = calculateStrength(entry, oneDay)
    // e^(-24/24) = e^(-1) ≈ 0.368 → 37
    expect(strength).toBe(37)
  })

  it('decays more after 7 days', () => {
    const created = new Date('2025-01-01T00:00:00Z')
    const sevenDays = new Date('2025-01-08T00:00:00Z')
    const entry = makeEntry({ lastReinforcedAt: created.toISOString(), stability: 24, decayRate: 1.0 })
    const strength = calculateStrength(entry, sevenDays)
    // e^(-168/24) = e^(-7) ≈ 0.0009 → 0
    expect(strength).toBeLessThanOrEqual(1)
  })

  it('decays significantly after 30 days', () => {
    const created = new Date('2025-01-01T00:00:00Z')
    const thirtyDays = new Date('2025-01-31T00:00:00Z')
    const entry = makeEntry({ lastReinforcedAt: created.toISOString(), stability: 24, decayRate: 1.0 })
    const strength = calculateStrength(entry, thirtyDays)
    expect(strength).toBe(0)
  })

  it('higher stability means slower decay', () => {
    const created = new Date('2025-01-01T00:00:00Z')
    const oneDay = new Date('2025-01-02T00:00:00Z')

    const lowStability = makeEntry({ lastReinforcedAt: created.toISOString(), stability: 24 })
    const highStability = makeEntry({ lastReinforcedAt: created.toISOString(), stability: 168 })

    const lowStrength = calculateStrength(lowStability, oneDay)
    const highStrength = calculateStrength(highStability, oneDay)

    expect(highStrength).toBeGreaterThan(lowStrength)
  })

  it('lower decayRate means slower decay', () => {
    const created = new Date('2025-01-01T00:00:00Z')
    const oneDay = new Date('2025-01-02T00:00:00Z')

    const fastDecay = makeEntry({ lastReinforcedAt: created.toISOString(), decayRate: 2.0 })
    const slowDecay = makeEntry({ lastReinforcedAt: created.toISOString(), decayRate: 0.5 })

    expect(calculateStrength(slowDecay, oneDay)).toBeGreaterThan(calculateStrength(fastDecay, oneDay))
  })

  it('migrates old entries automatically', () => {
    const oldEntry: MemoryEntry = {
      id: 'old',
      content: 'old memory',
      category: 'lesson',
      keywords: ['old'],
      source,
      confidence: 0.5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accessCount: 0,
      // No strength/stability/etc fields
    }
    // Should not throw, returns a valid strength
    const strength = calculateStrength(oldEntry)
    expect(strength).toBeGreaterThanOrEqual(0)
    expect(strength).toBeLessThanOrEqual(100)
  })
})

describe('reinforceMemory', () => {
  beforeEach(clearAll)

  it('returns null for non-existent entry', async () => {
    const result = await reinforceMemory('nonexistent', 'access')
    expect(result).toBeNull()
  })

  it('increases stability on access', async () => {
    const entry = addMemory('reinforce test', 'lesson', source, { keywords: ['reinforce'] })
    const migrated = migrateMemoryEntry(entry)
    const initialStability = migrated.stability!

    const result = await reinforceMemory(entry.id, 'access')
    expect(result).not.toBeNull()
    // access multiplier is 1.2
    expect(result!.stability).toBeCloseTo(initialStability * 1.2, 1)
  })

  it('increases stability more on task_success', async () => {
    const entry = addMemory('success test', 'lesson', source, { keywords: ['success'] })
    const migrated = migrateMemoryEntry(entry)
    const initialStability = migrated.stability!

    const result = await reinforceMemory(entry.id, 'task_success')
    // task_success multiplier is 2.0
    expect(result!.stability).toBeCloseTo(initialStability * 2.0, 1)
  })

  it('decreases stability on task_failure', async () => {
    const entry = addMemory('failure test', 'lesson', source, { keywords: ['failure'] })
    // Migrate first, then override stability
    const migrated = migrateMemoryEntry(entry)
    saveMemory({ ...migrated, stability: 100 })

    const result = await reinforceMemory(entry.id, 'task_failure')
    // task_failure multiplier is 0.8
    expect(result!.stability).toBeCloseTo(100 * 0.8, 1)
  })

  it('increments reinforceCount', async () => {
    const entry = addMemory('count test', 'lesson', source, { keywords: ['count'] })
    const r1 = await reinforceMemory(entry.id, 'access')
    expect(r1!.reinforceCount).toBe(1)

    const r2 = await reinforceMemory(entry.id, 'access')
    expect(r2!.reinforceCount).toBe(2)
  })

  it('caps stability at maxStability', async () => {
    const entry = addMemory('cap test', 'lesson', source, { keywords: ['cap'] })
    // Set stability very high
    const migrated = migrateMemoryEntry(entry)
    saveMemory({ ...migrated, stability: 8000 })

    const result = await reinforceMemory(entry.id, 'task_success')
    // 8000 * 2.0 = 16000, but max is 8760
    expect(result!.stability).toBeLessThanOrEqual(8760)
  })

  it('adjusts decayRate based on confidence', async () => {
    const highConf = addMemory('high conf', 'lesson', source, {
      keywords: ['highconf'],
      confidence: 0.9,
    })
    const lowConf = addMemory('low conf', 'lesson', source, {
      keywords: ['lowconf'],
      confidence: 0.3,
    })

    const r1 = await reinforceMemory(highConf.id, 'access')
    const r2 = await reinforceMemory(lowConf.id, 'access')

    // High confidence → lower decayRate (0.7 factor)
    expect(r1!.decayRate!).toBeLessThan(r2!.decayRate!)
  })

  it('adjusts decayRate for pitfall category', async () => {
    const pitfall = addMemory('pitfall memory', 'pitfall', source, { keywords: ['pitfall'] })
    const lesson = addMemory('lesson memory', 'lesson', source, { keywords: ['lesson2'] })

    const r1 = await reinforceMemory(pitfall.id, 'access')
    const r2 = await reinforceMemory(lesson.id, 'access')

    // Same confidence, but pitfall gets 0.9 factor → lower decayRate
    expect(r1!.decayRate!).toBeLessThanOrEqual(r2!.decayRate!)
  })
})

describe('cleanupFadingMemories', () => {
  beforeEach(clearAll)

  it('deletes memories below deleteThreshold', async () => {
    const entry = addMemory('weak memory', 'lesson', source, { keywords: ['weak'] })
    // Set very old lastReinforcedAt and low stability so strength → 0
    const veryOld = new Date('2020-01-01T00:00:00Z').toISOString()
    saveMemory({
      ...migrateMemoryEntry(entry),
      stability: 1,
      lastReinforcedAt: veryOld,
      decayRate: 1.0,
    })

    const result = await cleanupFadingMemories()
    expect(result.deleted).toBe(1)
    expect(getMemory(entry.id)).toBeNull()
  })

  it('archives memories below archiveThreshold but above deleteThreshold', async () => {
    const entry = addMemory('fading memory', 'lesson', source, { keywords: ['fading'] })
    // Set lastReinforcedAt so strength is between 5 and 10
    // With stability=24, decayRate=1.0: strength = e^(-t/24)*100
    // For strength ≈ 7: t ≈ -24*ln(0.07) ≈ 63.8 hours
    const hoursAgo = 63
    const past = new Date(Date.now() - hoursAgo * 3600000).toISOString()
    saveMemory({
      ...migrateMemoryEntry(entry),
      stability: 24,
      lastReinforcedAt: past,
      decayRate: 1.0,
    })

    const result = await cleanupFadingMemories()
    // Should be archived (strength ~7, between deleteThreshold=5 and archiveThreshold=10)
    expect(result.archived).toBe(1)
    const updated = getMemory(entry.id)
    expect(updated).not.toBeNull()
    expect(updated!.strength).toBe(0)
  })

  it('leaves healthy memories untouched', async () => {
    const entry = addMemory('healthy memory', 'lesson', source, { keywords: ['healthy'] })
    // Fresh memory has high strength
    saveMemory(migrateMemoryEntry(entry))

    const result = await cleanupFadingMemories()
    expect(result.archived).toBe(0)
    expect(result.deleted).toBe(0)
    expect(getMemory(entry.id)).not.toBeNull()
  })
})

describe('getMemoryHealth', () => {
  beforeEach(clearAll)

  it('returns health status for all memories', async () => {
    addMemory('memory one', 'lesson', source, { keywords: ['one'] })
    addMemory('memory two', 'pattern', source, { keywords: ['two'] })

    const health = await getMemoryHealth()
    expect(health).toHaveLength(2)
    for (const h of health) {
      expect(h).toHaveProperty('id')
      expect(h).toHaveProperty('title')
      expect(h).toHaveProperty('strength')
      expect(h).toHaveProperty('daysUntilFade')
      expect(h.strength).toBeGreaterThanOrEqual(0)
      expect(h.strength).toBeLessThanOrEqual(100)
    }
  })

  it('shows daysUntilFade=0 for already faded memories', async () => {
    const entry = addMemory('faded', 'lesson', source, { keywords: ['faded'] })
    const veryOld = new Date('2020-01-01T00:00:00Z').toISOString()
    saveMemory({
      ...migrateMemoryEntry(entry),
      stability: 1,
      lastReinforcedAt: veryOld,
      decayRate: 1.0,
    })

    const health = await getMemoryHealth()
    const item = health.find(h => h.id === entry.id)
    expect(item).toBeDefined()
    expect(item!.daysUntilFade).toBe(0)
  })
})
