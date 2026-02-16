import { describe, it, expect, beforeEach } from 'vitest'
import { addMemory, removeMemory } from '../manageMemory.js'
import { calculateStrength } from '../forgettingEngine.js'
import { buildAssociations, spreadActivation } from '../associationEngine.js'
import { migrateMemoryEntry } from '../migrateMemory.js'
import { getAllMemories, saveMemory } from '../../store/MemoryStore.js'
import type { MemoryCategory, MemoryEntry, MemorySource } from '../types.js'

function clearAll() {
  for (const m of getAllMemories()) {
    removeMemory(m.id)
  }
}

const CATEGORIES: MemoryCategory[] = ['pattern', 'lesson', 'preference', 'pitfall', 'tool']
const KEYWORD_POOLS = [
  ['typescript', 'types', 'generics'],
  ['react', 'hooks', 'state'],
  ['vitest', 'testing', 'mock'],
  ['docker', 'deploy', 'ci'],
  ['database', 'query', 'optimization'],
  ['api', 'rest', 'graphql'],
  ['security', 'auth', 'jwt'],
  ['performance', 'caching', 'redis'],
]

function createSimulatedMemories(count: number): MemoryEntry[] {
  const entries: MemoryEntry[] = []
  const now = Date.now()

  for (let i = 0; i < count; i++) {
    const pool = KEYWORD_POOLS[i % KEYWORD_POOLS.length]!
    const category = CATEGORIES[i % CATEGORIES.length]!
    // Spread creation over 30 days
    const daysAgo = (i / count) * 30
    const createdAt = new Date(now - daysAgo * 24 * 3600000).toISOString()
    // Simulate varying reinforcement counts (some frequently used, some not)
    const reinforceCount = i < 20 ? Math.floor(Math.random() * 10) + 5 : Math.floor(Math.random() * 2)
    // Higher reinforcement → higher stability
    const stability = 24 + reinforceCount * 24
    const confidence = 0.3 + Math.random() * 0.7

    const source: MemorySource = { type: 'task', taskId: `task-${i % 10}` }
    const entry = addMemory(
      `Memory #${i}: ${pool.join(' ')} insights`,
      category,
      source,
      { keywords: pool, confidence },
    )

    // Migrate and set forgetting engine fields
    const migrated: MemoryEntry = {
      ...migrateMemoryEntry(entry),
      stability,
      reinforceCount,
      lastReinforcedAt: createdAt,
      decayRate: reinforceCount >= 5 ? 0.7 : 1.0,
    }
    saveMemory(migrated)
    entries.push(migrated)
  }

  return entries
}

describe('memory simulation', () => {
  beforeEach(clearAll)

  it('forgetting curve: frequently used memories stay strong, unused ones decay', () => {
    const entries = createSimulatedMemories(100)
    const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 3600000)

    // Separate into high-frequency (first 20) and low-frequency (rest)
    const highFreq = entries.slice(0, 20)
    const lowFreq = entries.slice(20)

    const highStrengths = highFreq.map(e => calculateStrength(e, thirtyDaysLater))
    const lowStrengths = lowFreq.map(e => calculateStrength(e, thirtyDaysLater))

    const avgHigh = highStrengths.reduce((s, v) => s + v, 0) / highStrengths.length
    const avgLow = lowStrengths.reduce((s, v) => s + v, 0) / lowStrengths.length

    // High frequency memories should retain significantly more strength
    expect(avgHigh).toBeGreaterThan(avgLow)

    // Most low-frequency memories should have decayed substantially
    const decayedLow = lowStrengths.filter(s => s < 30).length
    expect(decayedLow).toBeGreaterThan(lowFreq.length * 0.5)
  })

  it('strength decreases monotonically over time', () => {
    const entry = migrateMemoryEntry(
      addMemory('monotonic test', 'lesson', { type: 'task' }, { keywords: ['monotonic'] }),
    )
    saveMemory(entry)

    const strengths: number[] = []
    for (let day = 0; day <= 30; day++) {
      const future = new Date(Date.now() + day * 24 * 3600000)
      strengths.push(calculateStrength(entry, future))
    }

    // Each subsequent day should have equal or lower strength
    for (let i = 1; i < strengths.length; i++) {
      expect(strengths[i]).toBeLessThanOrEqual(strengths[i - 1]!)
    }
  })

  it('association network: related memories found through activation spreading', async () => {
    // Create a chain: A → B → C via shared keywords
    const a = addMemory('typescript generics advanced', 'pattern',
      { type: 'task', taskId: 't1' },
      { keywords: ['typescript', 'generics', 'advanced'] })
    const b = addMemory('typescript testing with generics', 'lesson',
      { type: 'task', taskId: 't1' },
      { keywords: ['typescript', 'testing', 'generics'] })
    const c = addMemory('vitest testing patterns', 'pattern',
      { type: 'task', taskId: 't2' },
      { keywords: ['vitest', 'testing', 'patterns'] })
    const unrelated = addMemory('docker deployment guide', 'tool',
      { type: 'task', taskId: 't3' },
      { keywords: ['docker', 'deployment', 'kubernetes'] })

    // Move unrelated entry far away in time to prevent temporal proximity associations
    const farPast = new Date(Date.now() - 7 * 24 * 3600000).toISOString()
    saveMemory({ ...migrateMemoryEntry(unrelated), createdAt: farPast })

    // Migrate all
    const all = getAllMemories().map(migrateMemoryEntry)

    // Build associations for all entries
    for (const entry of all) {
      entry.associations = await buildAssociations(entry, all)
      saveMemory(entry)
    }

    // Reload with updated associations
    const updated = getAllMemories().map(migrateMemoryEntry)

    // A should associate with B (shared 'typescript', 'generics')
    const aEntry = updated.find(e => e.id === a.id)!
    expect(aEntry.associations!.some(assoc => assoc.targetId === b.id)).toBe(true)

    // Spread from A should reach B directly, and potentially C through B
    const spread = await spreadActivation(a.id, updated, 2)
    const spreadIds = spread.map(s => s.entry.id)

    expect(spreadIds).toContain(b.id)
    // C should be reachable if B→C association exists (shared 'testing')
    const bEntry = updated.find(e => e.id === b.id)!
    if (bEntry.associations!.some(assoc => assoc.targetId === c.id)) {
      expect(spreadIds).toContain(c.id)
    }

    // Unrelated entry should NOT appear
    expect(spreadIds).not.toContain(unrelated.id)
  })

  it('association activation values decrease with distance', async () => {
    const a = addMemory('entry A', 'lesson', { type: 'task' }, { keywords: ['alpha', 'beta'] })
    const b = addMemory('entry B', 'lesson', { type: 'task' }, { keywords: ['beta', 'gamma'] })
    const c = addMemory('entry C', 'lesson', { type: 'task' }, { keywords: ['gamma', 'delta'] })

    const all = getAllMemories().map(migrateMemoryEntry)
    for (const entry of all) {
      entry.associations = await buildAssociations(entry, all)
      saveMemory(entry)
    }

    const updated = getAllMemories().map(migrateMemoryEntry)
    const spread = await spreadActivation(a.id, updated, 3)

    const bActivation = spread.find(s => s.entry.id === b.id)
    const cActivation = spread.find(s => s.entry.id === c.id)

    if (bActivation && cActivation) {
      // B (distance 1) should have higher activation than C (distance 2)
      expect(bActivation.activationLevel).toBeGreaterThan(cActivation.activationLevel)
    }
  })
})
