import { describe, it, expect, beforeEach } from 'vitest'
import { addMemory, removeMemory } from '../manageMemory.js'
import { retrieveRelevantMemories } from '../retrieveMemory.js'
import { calculateStrength, reinforceMemory, cleanupFadingMemories } from '../forgettingEngine.js'
import { buildAssociations } from '../associationEngine.js'
import { migrateMemoryEntry, needsMigration } from '../migrateMemory.js'
import { getAllMemories, getMemory, saveMemory } from '../../store/MemoryStore.js'
import type { MemorySource } from '../types.js'

const source: MemorySource = { type: 'task', taskId: 'lifecycle-test' }

function clearAll() {
  for (const m of getAllMemories()) {
    removeMemory(m.id)
  }
}

describe('memory lifecycle', () => {
  beforeEach(clearAll)

  it('full lifecycle: create → retrieve (reinforce) → associate → decay → cleanup', async () => {
    // 1. Create memories
    const mem1 = addMemory('vitest testing patterns', 'pattern', source, {
      keywords: ['vitest', 'testing', 'patterns'],
      confidence: 0.8,
    })
    const mem2 = addMemory('vitest configuration guide', 'lesson', source, {
      keywords: ['vitest', 'config', 'setup'],
      confidence: 0.7,
    })
    const mem3 = addMemory('react component patterns', 'pattern', source, {
      keywords: ['react', 'component', 'patterns'],
      confidence: 0.6,
    })

    // Verify creation - new entries need migration
    expect(needsMigration(mem1)).toBe(true)

    // 2. Retrieve → auto-migrates and reinforces
    const results = await retrieveRelevantMemories('vitest testing')
    expect(results.length).toBeGreaterThanOrEqual(2)

    // After retrieval, accessCount should increase
    const updated1 = getMemory(mem1.id)!
    expect(updated1.accessCount).toBeGreaterThanOrEqual(1)

    // 3. Build associations
    const allEntries = getAllMemories().map(migrateMemoryEntry)
    const assocs = await buildAssociations(migrateMemoryEntry(mem1), allEntries)
    // mem1 shares 'vitest' with mem2, 'patterns' with mem3
    expect(assocs.length).toBeGreaterThanOrEqual(1)

    // Save associations
    const m1 = migrateMemoryEntry(getMemory(mem1.id)!)
    m1.associations = assocs
    saveMemory(m1)

    // 4. Simulate time passing: set lastReinforcedAt far in the past
    const veryOld = new Date('2020-01-01T00:00:00Z').toISOString()
    saveMemory({ ...migrateMemoryEntry(getMemory(mem3.id)!), stability: 1, lastReinforcedAt: veryOld })

    // 5. Verify decay
    const mem3Updated = getMemory(mem3.id)!
    const strength = calculateStrength(migrateMemoryEntry(mem3Updated))
    expect(strength).toBeLessThan(5) // should be effectively 0

    // 6. Cleanup removes the decayed memory
    const cleanup = await cleanupFadingMemories()
    expect(cleanup.deleted).toBeGreaterThanOrEqual(1)
    expect(getMemory(mem3.id)).toBeNull()

    // Healthy memories survive
    expect(getMemory(mem1.id)).not.toBeNull()
    expect(getMemory(mem2.id)).not.toBeNull()
  })

  it('reinforcement extends memory lifetime', async () => {
    const entry = addMemory('important pattern', 'pattern', source, {
      keywords: ['important'],
      confidence: 0.9,
    })

    // Reinforce multiple times
    await reinforceMemory(entry.id, 'task_success')
    await reinforceMemory(entry.id, 'task_success')
    await reinforceMemory(entry.id, 'access')

    const reinforced = getMemory(entry.id)!
    const migrated = migrateMemoryEntry(reinforced)

    // After multiple reinforcements:
    // - stability should be much higher than initial
    // - reinforceCount should be 3
    expect(migrated.reinforceCount).toBe(3)
    expect(migrated.stability!).toBeGreaterThan(24) // initial default

    // Even after some time, should remain strong
    const threeDaysLater = new Date(Date.now() + 3 * 24 * 3600000)
    const strength = calculateStrength(migrated, threeDaysLater)
    expect(strength).toBeGreaterThan(50)
  })
})

describe('backward compatibility', () => {
  beforeEach(clearAll)

  it('old format memories auto-migrate and work normally', async () => {
    // Simulate an old-format entry (no forgetting/association fields)
    const oldEntry = {
      id: 'old-entry',
      content: 'legacy typescript tip',
      category: 'lesson' as const,
      keywords: ['typescript', 'tip'],
      source: { type: 'task' as const, taskId: 'old-task' },
      confidence: 0.8,
      createdAt: new Date(Date.now() - 7 * 24 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 7 * 24 * 3600000).toISOString(),
      accessCount: 5,
    }

    // Save without new fields
    saveMemory(oldEntry as unknown as import('../types.js').MemoryEntry)

    // Verify it needs migration
    const raw = getMemory('old-entry')!
    expect(needsMigration(raw)).toBe(true)

    // Migration should add all new fields
    const migrated = migrateMemoryEntry(raw)
    expect(migrated.strength).toBe(50) // default
    expect(migrated.stability).toBeGreaterThan(24) // base + accessCount bonus
    expect(migrated.decayRate).toBe(1.0)
    expect(migrated.reinforceCount).toBe(0)
    expect(migrated.associations).toEqual([])

    // Retrieval should work (uses migrateMemoryEntry internally)
    const results = await retrieveRelevantMemories('typescript tip')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(r => r.id === 'old-entry')).toBe(true)
  })

  it('already migrated entries pass through unchanged', () => {
    const now = new Date().toISOString()
    const newEntry = {
      id: 'new-entry',
      content: 'new format',
      category: 'lesson' as const,
      keywords: ['new'],
      source: { type: 'task' as const },
      confidence: 0.5,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      strength: 80,
      stability: 48,
      lastReinforcedAt: now,
      reinforceCount: 2,
      decayRate: 0.7,
      associations: [{ targetId: 'other', weight: 0.5, type: 'keyword' as const }],
    }

    expect(needsMigration(newEntry)).toBe(false)
    const migrated = migrateMemoryEntry(newEntry)
    // Should be the exact same reference (no allocation)
    expect(migrated).toBe(newEntry)
  })
})
