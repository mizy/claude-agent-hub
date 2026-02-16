import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildAssociations,
  spreadActivation,
  associativeRetrieve,
  rebuildAllAssociations,
  updateAssociationStrength,
} from '../associationEngine.js'
import { addMemory, removeMemory } from '../manageMemory.js'
import { getAllMemories, getMemory, saveMemory } from '../../store/MemoryStore.js'
import { migrateMemoryEntry } from '../migrateMemory.js'
import type { MemoryEntry, MemorySource } from '../types.js'

const source: MemorySource = { type: 'task', taskId: 'test-task' }

function clearAll() {
  for (const m of getAllMemories()) {
    removeMemory(m.id)
  }
}

function makeEntry(id: string, keywords: string[], overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = new Date().toISOString()
  const base = migrateMemoryEntry({
    id,
    content: `memory about ${keywords.join(', ')}`,
    category: 'lesson',
    keywords,
    source,
    confidence: 0.5,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
  })
  return { ...base, ...overrides }
}

describe('buildAssociations', () => {
  it('creates keyword associations when Jaccard overlap >= threshold', async () => {
    const now = new Date()
    const farPast = new Date(now.getTime() - 7 * 24 * 3600000).toISOString() // 7 days ago
    // Use different taskIds to isolate keyword associations from co-task
    const srcA: MemorySource = { type: 'task', taskId: 'kw-a' }
    const srcB: MemorySource = { type: 'task', taskId: 'kw-b' }
    const srcC: MemorySource = { type: 'task', taskId: 'kw-c' }

    const entry = makeEntry('a', ['typescript', 'testing', 'vitest'], { createdAt: now.toISOString(), source: srcA })
    const others = [
      makeEntry('b', ['typescript', 'testing', 'jest'], { createdAt: farPast, source: srcB }),  // Jaccard: 2/4 = 0.5
      makeEntry('c', ['react', 'hooks', 'state'], { createdAt: farPast, source: srcC }),        // Jaccard: 0, too old for temporal
    ]

    const assocs = await buildAssociations(entry, [entry, ...others])
    expect(assocs.some(a => a.targetId === 'b')).toBe(true)
    expect(assocs.some(a => a.targetId === 'c')).toBe(false)
  })

  it('creates co-task associations for entries from the same task', async () => {
    const sameTaskSource: MemorySource = { type: 'task', taskId: 'shared-task' }
    const entry = makeEntry('a', ['deploy'], { source: sameTaskSource })
    const sameTask = makeEntry('b', ['config'], { source: sameTaskSource })
    const diffTask = makeEntry('c', ['deploy'], { source: { type: 'task', taskId: 'other-task' } })

    const assocs = await buildAssociations(entry, [entry, sameTask, diffTask])
    const coTaskAssoc = assocs.find(a => a.targetId === 'b')
    expect(coTaskAssoc).toBeDefined()
    expect(coTaskAssoc!.weight).toBe(0.5)
  })

  it('creates temporal associations for entries created within 24h', async () => {
    const now = new Date()
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600000)
    const twoDaysAgo = new Date(now.getTime() - 48 * 3600000)

    // Use different taskIds to isolate temporal from co-task associations
    const srcA: MemorySource = { type: 'task', taskId: 'temporal-a' }
    const srcB: MemorySource = { type: 'task', taskId: 'temporal-b' }
    const srcC: MemorySource = { type: 'task', taskId: 'temporal-c' }

    const entry = makeEntry('a', ['deploy'], { createdAt: now.toISOString(), source: srcA })
    const recent = makeEntry('b', ['config'], { createdAt: twoHoursAgo.toISOString(), source: srcB })
    const old = makeEntry('c', ['docker'], { createdAt: twoDaysAgo.toISOString(), source: srcC })

    const assocs = await buildAssociations(entry, [entry, recent, old])
    expect(assocs.some(a => a.targetId === 'b')).toBe(true)
    expect(assocs.some(a => a.targetId === 'c')).toBe(false)
  })

  it('does not create self-associations', async () => {
    const entry = makeEntry('a', ['typescript', 'testing'])
    const assocs = await buildAssociations(entry, [entry])
    expect(assocs).toHaveLength(0)
  })

  it('merges duplicate associations keeping the strongest', async () => {
    // Entry with same-task + keyword overlap → both create associations to same target
    const sharedSource: MemorySource = { type: 'task', taskId: 'shared' }
    const entry = makeEntry('a', ['typescript', 'testing'], { source: sharedSource })
    const other = makeEntry('b', ['typescript', 'testing', 'vitest'], { source: sharedSource })

    const assocs = await buildAssociations(entry, [entry, other])
    // Should only have one association to 'b' (merged)
    const toB = assocs.filter(a => a.targetId === 'b')
    expect(toB).toHaveLength(1)
  })
})

describe('spreadActivation', () => {
  it('spreads activation to directly associated entries', async () => {
    const a = makeEntry('a', ['ts'], { associations: [{ targetId: 'b', weight: 0.8, type: 'keyword' }] })
    const b = makeEntry('b', ['ts', 'test'])

    const results = await spreadActivation('a', [a, b])
    expect(results).toHaveLength(1)
    expect(results[0]!.entry.id).toBe('b')
    // activation = 1.0 * 0.8 * 0.5 = 0.4
    expect(results[0]!.activationLevel).toBeCloseTo(0.4, 2)
  })

  it('spreads activation through multiple hops with decay', async () => {
    const a = makeEntry('a', ['ts'], { associations: [{ targetId: 'b', weight: 1.0, type: 'keyword' }] })
    const b = makeEntry('b', ['ts'], { associations: [{ targetId: 'c', weight: 1.0, type: 'keyword' }] })
    const c = makeEntry('c', ['test'])

    const results = await spreadActivation('a', [a, b, c], 2)
    expect(results).toHaveLength(2)

    const bResult = results.find(r => r.entry.id === 'b')
    const cResult = results.find(r => r.entry.id === 'c')

    // b: 1.0 * 1.0 * 0.5 = 0.5
    expect(bResult!.activationLevel).toBeCloseTo(0.5, 2)
    // c: 0.5 * 1.0 * 0.5 = 0.25
    expect(cResult!.activationLevel).toBeCloseTo(0.25, 2)
  })

  it('does not revisit already-activated entries', async () => {
    // A -> B -> A (cycle)
    const a = makeEntry('a', ['ts'], { associations: [{ targetId: 'b', weight: 1.0, type: 'keyword' }] })
    const b = makeEntry('b', ['ts'], { associations: [{ targetId: 'a', weight: 1.0, type: 'keyword' }] })

    const results = await spreadActivation('a', [a, b], 3)
    // Only b should be activated (a is the start, not revisited)
    expect(results).toHaveLength(1)
    expect(results[0]!.entry.id).toBe('b')
  })

  it('respects maxDepth', async () => {
    const a = makeEntry('a', ['ts'], { associations: [{ targetId: 'b', weight: 1.0, type: 'keyword' }] })
    const b = makeEntry('b', ['ts'], { associations: [{ targetId: 'c', weight: 1.0, type: 'keyword' }] })
    const c = makeEntry('c', ['test'])

    const results = await spreadActivation('a', [a, b, c], 1)
    // Only depth=1, so only b should be reached
    expect(results).toHaveLength(1)
    expect(results[0]!.entry.id).toBe('b')
  })

  it('filters out very weak activations (< 0.01)', async () => {
    const a = makeEntry('a', ['ts'], { associations: [{ targetId: 'b', weight: 0.01, type: 'keyword' }] })
    const b = makeEntry('b', ['ts'])

    const results = await spreadActivation('a', [a, b])
    // 1.0 * 0.01 * 0.5 = 0.005 < 0.01 threshold
    expect(results).toHaveLength(0)
  })

  it('returns empty for non-existent start entry', async () => {
    const a = makeEntry('a', ['ts'])
    const results = await spreadActivation('nonexistent', [a])
    expect(results).toHaveLength(0)
  })

  it('sorts results by activation level descending', async () => {
    const a = makeEntry('a', ['ts'], {
      associations: [
        { targetId: 'b', weight: 0.3, type: 'keyword' },
        { targetId: 'c', weight: 0.9, type: 'keyword' },
      ],
    })
    const b = makeEntry('b', ['test1'])
    const c = makeEntry('c', ['test2'])

    const results = await spreadActivation('a', [a, b, c])
    expect(results[0]!.entry.id).toBe('c')
    expect(results[1]!.entry.id).toBe('b')
  })
})

describe('updateAssociationStrength', () => {
  beforeEach(clearAll)

  it('creates new bidirectional association if none exists', () => {
    const e1 = addMemory('memory one', 'lesson', source, { keywords: ['one'] })
    const e2 = addMemory('memory two', 'lesson', source, { keywords: ['two'] })
    // Ensure they have associations array
    saveMemory(migrateMemoryEntry(e1))
    saveMemory(migrateMemoryEntry(e2))

    updateAssociationStrength(e1.id, e2.id, 0.3)

    const updated1 = getMemory(e1.id)!
    const updated2 = getMemory(e2.id)!
    expect(updated1.associations!.some(a => a.targetId === e2.id)).toBe(true)
    expect(updated2.associations!.some(a => a.targetId === e1.id)).toBe(true)
  })

  it('boosts existing association strength', () => {
    const e1 = addMemory('memory one', 'lesson', source, { keywords: ['one'] })
    const e2 = addMemory('memory two', 'lesson', source, { keywords: ['two'] })
    saveMemory({ ...migrateMemoryEntry(e1), associations: [{ targetId: e2.id, weight: 0.3, type: 'keyword' as const }] })
    saveMemory(migrateMemoryEntry(e2))

    updateAssociationStrength(e1.id, e2.id, 0.2)

    const updated1 = getMemory(e1.id)!
    const assoc = updated1.associations!.find(a => a.targetId === e2.id)
    expect(assoc!.weight).toBeCloseTo(0.5, 2)
  })

  it('caps association weight at 1.0', () => {
    const e1 = addMemory('memory one', 'lesson', source, { keywords: ['one'] })
    const e2 = addMemory('memory two', 'lesson', source, { keywords: ['two'] })
    saveMemory({ ...migrateMemoryEntry(e1), associations: [{ targetId: e2.id, weight: 0.9, type: 'keyword' as const }] })
    saveMemory(migrateMemoryEntry(e2))

    updateAssociationStrength(e1.id, e2.id, 0.5)

    const updated1 = getMemory(e1.id)!
    const assoc = updated1.associations!.find(a => a.targetId === e2.id)
    expect(assoc!.weight).toBeLessThanOrEqual(1.0)
  })
})

describe('associativeRetrieve', () => {
  it('returns entries matching query keywords', async () => {
    const entries = [
      makeEntry('a', ['typescript', 'testing'], { strength: 80 }),
      makeEntry('b', ['react', 'hooks'], { strength: 80 }),
    ]

    const results = await associativeRetrieve('typescript testing', entries)
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.id).toBe('a')
  })

  it('returns empty for no keyword match', async () => {
    const entries = [makeEntry('a', ['python', 'flask'])]
    const results = await associativeRetrieve('typescript testing', entries)
    expect(results).toHaveLength(0)
  })

  it('includes associated entries via activation spreading', async () => {
    const a = makeEntry('a', ['typescript', 'testing'], {
      strength: 80,
      associations: [{ targetId: 'b', weight: 0.8, type: 'keyword' }],
    })
    const b = makeEntry('b', ['vitest', 'config'], { strength: 80 })

    const results = await associativeRetrieve('typescript testing', [a, b])
    // b should appear through activation spreading from a
    expect(results.some(r => r.id === 'b')).toBe(true)
  })

  it('weights results by strength', async () => {
    const strong = makeEntry('strong', ['typescript'], { strength: 90 })
    const weak = makeEntry('weak', ['typescript'], { strength: 20 })

    const results = await associativeRetrieve('typescript', [strong, weak])
    expect(results[0]!.id).toBe('strong')
  })

  it('returns empty for empty query keywords', async () => {
    const entries = [makeEntry('a', ['test'])]
    const results = await associativeRetrieve('a', entries) // 'a' likely yields no keywords
    expect(results).toHaveLength(0)
  })
})

describe('rebuildAllAssociations', () => {
  beforeEach(clearAll)

  it('rebuilds associations for all entries', async () => {
    // Create entries with overlapping keywords
    const e1 = addMemory('typescript patterns', 'pattern', source, {
      keywords: ['typescript', 'patterns', 'best-practices'],
    })
    const e2 = addMemory('typescript testing', 'lesson', source, {
      keywords: ['typescript', 'testing', 'patterns'],
    })
    addMemory('react hooks guide', 'lesson', source, {
      keywords: ['react', 'hooks', 'guide'],
    })
    // Migrate all
    for (const m of getAllMemories()) {
      saveMemory(migrateMemoryEntry(m))
    }

    const result = await rebuildAllAssociations()
    expect(result.total).toBe(3)

    // e1 and e2 share 'typescript' and 'patterns' → should have association
    const updated1 = getMemory(e1.id)!
    const updated2 = getMemory(e2.id)!
    expect(updated1.associations!.some(a => a.targetId === e2.id)).toBe(true)
    expect(updated2.associations!.some(a => a.targetId === e1.id)).toBe(true)
  })
})
