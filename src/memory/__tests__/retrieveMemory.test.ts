import { describe, it, expect, beforeEach } from 'vitest'
import { retrieveRelevantMemories } from '../retrieveMemory.js'
import { addMemory, removeMemory } from '../manageMemory.js'
import { getAllMemories, getMemory, updateMemory } from '../../store/MemoryStore.js'
import type { MemorySource } from '../types.js'

const source: MemorySource = { type: 'task', taskId: 'test-task' }

function clearAll() {
  for (const m of getAllMemories()) {
    removeMemory(m.id)
  }
}

describe('retrieveRelevantMemories', () => {
  beforeEach(clearAll)

  it('returns empty array when no memories', async () => {
    const results = await retrieveRelevantMemories('anything')
    expect(results).toEqual([])
  })

  it('returns empty array when query has no extractable keywords', async () => {
    addMemory('some data', 'lesson', source, { keywords: ['data'] })
    const results = await retrieveRelevantMemories('a') // 'a' is a stopword
    expect(results).toEqual([])
  })

  it('returns matching entries ranked by keyword overlap', async () => {
    addMemory('vitest setup guide', 'lesson', source, {
      keywords: ['vitest', 'setup', 'guide'],
    })
    addMemory('vitest performance tips', 'pattern', source, {
      keywords: ['vitest', 'performance', 'tips'],
    })
    addMemory('react component patterns', 'pattern', source, {
      keywords: ['react', 'component', 'patterns'],
    })

    const results = await retrieveRelevantMemories('vitest setup testing')
    // The first entry matches 2 keywords (vitest, setup), second matches 1 (vitest)
    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results[0]!.content).toContain('vitest setup')
  })

  it('boosts score for matching projectPath', async () => {
    const id1 = addMemory('lesson about deployment', 'lesson', source, {
      keywords: ['deployment', 'docker'],
      confidence: 0.5,
      projectPath: '/proj-a',
    }).id
    addMemory('lesson about deployment config', 'lesson', source, {
      keywords: ['deployment', 'config'],
      confidence: 0.5,
      projectPath: '/proj-b',
    })

    // Both match 'deployment', but proj-a gets project path bonus
    const results = await retrieveRelevantMemories('deployment', { projectPath: '/proj-a' })
    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results[0]!.id).toBe(id1)
  })

  it('higher confidence scores higher', async () => {
    addMemory('low confidence tip', 'lesson', source, {
      keywords: ['typescript', 'types'],
      confidence: 0.1,
    })
    const highId = addMemory('high confidence tip', 'lesson', source, {
      keywords: ['typescript', 'types'],
      confidence: 1.0,
    }).id

    const results = await retrieveRelevantMemories('typescript types')
    expect(results[0]!.id).toBe(highId)
  })

  it('applies smooth time decay for old entries', async () => {
    // Create a "new" entry
    const newEntry = addMemory('new deployment tip', 'lesson', source, {
      keywords: ['deployment'],
      confidence: 0.5,
    })

    // Create an "old" entry with high stability so it survives filtering
    const oldEntry = addMemory('old deployment tip', 'lesson', source, {
      keywords: ['deployment'],
      confidence: 0.5,
    })
    // Simulate old entry: set lastReinforcedAt in past with high stability
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    updateMemory(oldEntry.id, {
      strength: 50,
      stability: 168, // 7 days stability
      lastReinforcedAt: twoDaysAgo,
      decayRate: 1.0,
      reinforceCount: 0,
    })

    const results = await retrieveRelevantMemories('deployment')
    expect(results.length).toBe(2)
    // New entry should rank higher due to higher strength
    expect(results[0]!.id).toBe(newEntry.id)
  })

  it('respects maxResults limit', async () => {
    for (let i = 0; i < 5; i++) {
      addMemory(`tip ${i} about typescript`, 'lesson', source, {
        keywords: ['typescript'],
      })
    }

    const results = await retrieveRelevantMemories('typescript', { maxResults: 3 })
    expect(results).toHaveLength(3)
  })

  it('increments accessCount on retrieved entries', async () => {
    const entry = addMemory('accessed entry', 'lesson', source, {
      keywords: ['accessed'],
    })
    expect(entry.accessCount).toBe(0)

    await retrieveRelevantMemories('accessed')

    const updated = getMemory(entry.id)
    expect(updated).not.toBeNull()
    expect(updated!.accessCount).toBe(1)
  })

  it('increments accessCount cumulatively', async () => {
    const entry = addMemory('multi access', 'lesson', source, {
      keywords: ['multi'],
    })

    await retrieveRelevantMemories('multi')
    await retrieveRelevantMemories('multi')

    const updated = getMemory(entry.id)
    expect(updated!.accessCount).toBe(2)
  })

  it('ranks non-matching entries lower than matching ones', async () => {
    addMemory('unrelated content', 'lesson', source, {
      keywords: ['unrelated'],
      confidence: 0.5,
    })
    const matchId = addMemory('typescript patterns', 'lesson', source, {
      keywords: ['typescript'],
      confidence: 0.5,
    }).id

    const results = await retrieveRelevantMemories('typescript')
    // Matching entry should rank first
    expect(results[0]!.id).toBe(matchId)
  })

  // --- New tests for iteration 3 improvements ---

  it('does NOT update updatedAt on retrieval, sets lastAccessedAt instead', async () => {
    const entry = addMemory('stable update test', 'lesson', source, {
      keywords: ['stable'],
    })
    const originalUpdatedAt = entry.updatedAt

    await retrieveRelevantMemories('stable')

    const updated = getMemory(entry.id)
    expect(updated!.updatedAt).toBe(originalUpdatedAt) // updatedAt unchanged
    expect(updated!.lastAccessedAt).toBeTruthy() // lastAccessedAt is set
  })

  it('boosts frequently accessed memories via accessCount', async () => {
    // Create two entries with same keywords and confidence
    const frequentEntry = addMemory('frequent tip', 'lesson', source, {
      keywords: ['testing'],
      confidence: 0.5,
    })
    addMemory('rare tip', 'lesson', source, {
      keywords: ['testing'],
      confidence: 0.5,
    })
    // Simulate high access count on frequent entry
    updateMemory(frequentEntry.id, { accessCount: 50 })

    const results = await retrieveRelevantMemories('testing')
    expect(results.length).toBe(2)
    // Frequently accessed entry should rank higher
    expect(results[0]!.id).toBe(frequentEntry.id)
  })

  it('time decay is gradual, not a step function', async () => {
    // All entries get high stability so none are filtered out
    const stability = 720 // 30 days in hours

    const newEntry = addMemory('new tip', 'lesson', source, {
      keywords: ['gradual'],
      confidence: 0.5,
    })
    const midEntry = addMemory('mid tip', 'lesson', source, {
      keywords: ['gradual'],
      confidence: 0.5,
    })
    const oldEntry = addMemory('old tip', 'lesson', source, {
      keywords: ['gradual'],
      confidence: 0.5,
    })

    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    // Set proper forgetting engine fields so entries survive strength filtering
    updateMemory(midEntry.id, {
      strength: 50, stability, lastReinforcedAt: fifteenDaysAgo, decayRate: 1.0, reinforceCount: 0,
    })
    updateMemory(oldEntry.id, {
      strength: 50, stability, lastReinforcedAt: sixtyDaysAgo, decayRate: 1.0, reinforceCount: 0,
    })

    const results = await retrieveRelevantMemories('gradual')
    expect(results).toHaveLength(3)
    // Order: new > mid > old (smooth decay)
    expect(results[0]!.id).toBe(newEntry.id)
    expect(results[1]!.id).toBe(midEntry.id)
    expect(results[2]!.id).toBe(oldEntry.id)
  })

  // --- Fuzzy matching and normalization tests ---

  it('matches @iflow query against iflow keyword (@ prefix normalization)', async () => {
    const entry = addMemory('user chose iflow backend for analysis', 'preference', source, {
      keywords: ['iflow', 'backend', 'analysis'],
      confidence: 0.8,
    })

    const results = await retrieveRelevantMemories('@iflow')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.id).toBe(entry.id)
  })

  it('matches iflow query against @iflow keyword (reverse normalization)', async () => {
    const entry = addMemory('switched to @iflow for architecture review', 'preference', source, {
      keywords: ['@iflow', 'architecture'],
      confidence: 0.8,
    })

    const results = await retrieveRelevantMemories('iflow')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.id).toBe(entry.id)
  })

  it('substring matching: partial keyword matches with lower score', async () => {
    const exactEntry = addMemory('iflow is fast', 'lesson', source, {
      keywords: ['iflow'],
      confidence: 0.5,
    })
    const substringEntry = addMemory('iflow_backend config', 'lesson', source, {
      keywords: ['iflow_backend'],
      confidence: 0.5,
    })

    const results = await retrieveRelevantMemories('iflow')
    expect(results.length).toBe(2)
    // Exact match should rank higher than substring
    expect(results[0]!.id).toBe(exactEntry.id)
    expect(results[1]!.id).toBe(substringEntry.id)
  })

  it('high-value domain keywords (backend names) get boosted', async () => {
    // Both entries match 'setup' keyword, but 'iflow' entry also matches a high-value keyword
    const domainEntry = addMemory('iflow backend setup', 'lesson', source, {
      keywords: ['iflow', 'setup'],
      confidence: 0.5,
    })
    addMemory('random tool setup', 'lesson', source, {
      keywords: ['random', 'setup'],
      confidence: 0.5,
    })

    // Query 'iflow setup' — both match 'setup', but domainEntry also matches 'iflow' (boosted)
    const results = await retrieveRelevantMemories('iflow setup')
    expect(results.length).toBe(2)
    // Domain keyword entry should rank first due to high-value keyword boost
    expect(results[0]!.id).toBe(domainEntry.id)
  })
})
