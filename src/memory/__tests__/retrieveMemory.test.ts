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

  it('returns empty array when no memories', () => {
    const results = retrieveRelevantMemories('anything')
    expect(results).toEqual([])
  })

  it('returns empty array when query has no extractable keywords', () => {
    addMemory('some data', 'lesson', source, { keywords: ['data'] })
    const results = retrieveRelevantMemories('a') // 'a' is a stopword
    expect(results).toEqual([])
  })

  it('returns matching entries ranked by keyword overlap', () => {
    addMemory('vitest setup guide', 'lesson', source, {
      keywords: ['vitest', 'setup', 'guide'],
    })
    addMemory('vitest performance tips', 'pattern', source, {
      keywords: ['vitest', 'performance', 'tips'],
    })
    addMemory('react component patterns', 'pattern', source, {
      keywords: ['react', 'component', 'patterns'],
    })

    const results = retrieveRelevantMemories('vitest setup testing')
    // The first entry matches 2 keywords (vitest, setup), second matches 1 (vitest)
    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results[0]!.content).toContain('vitest setup')
  })

  it('boosts score for matching projectPath', () => {
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
    const results = retrieveRelevantMemories('deployment', { projectPath: '/proj-a' })
    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results[0]!.id).toBe(id1)
  })

  it('higher confidence scores higher', () => {
    addMemory('low confidence tip', 'lesson', source, {
      keywords: ['typescript', 'types'],
      confidence: 0.1,
    })
    const highId = addMemory('high confidence tip', 'lesson', source, {
      keywords: ['typescript', 'types'],
      confidence: 1.0,
    }).id

    const results = retrieveRelevantMemories('typescript types')
    expect(results[0]!.id).toBe(highId)
  })

  it('applies time decay for old entries', () => {
    // Create a "new" entry
    const newEntry = addMemory('new deployment tip', 'lesson', source, {
      keywords: ['deployment'],
      confidence: 0.5,
    })

    // Create an "old" entry by directly manipulating updatedAt
    const oldEntry = addMemory('old deployment tip', 'lesson', source, {
      keywords: ['deployment'],
      confidence: 0.5,
    })
    // Simulate 60-day-old entry
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    updateMemory(oldEntry.id, { updatedAt: sixtyDaysAgo })

    const results = retrieveRelevantMemories('deployment')
    expect(results.length).toBe(2)
    // New entry should rank higher due to time decay on old entry
    expect(results[0]!.id).toBe(newEntry.id)
  })

  it('respects maxResults limit', () => {
    for (let i = 0; i < 5; i++) {
      addMemory(`tip ${i} about typescript`, 'lesson', source, {
        keywords: ['typescript'],
      })
    }

    const results = retrieveRelevantMemories('typescript', { maxResults: 3 })
    expect(results).toHaveLength(3)
  })

  it('increments accessCount on retrieved entries', () => {
    const entry = addMemory('accessed entry', 'lesson', source, {
      keywords: ['accessed'],
    })
    expect(entry.accessCount).toBe(0)

    retrieveRelevantMemories('accessed')

    const updated = getMemory(entry.id)
    expect(updated).not.toBeNull()
    expect(updated!.accessCount).toBe(1)
  })

  it('increments accessCount cumulatively', () => {
    const entry = addMemory('multi access', 'lesson', source, {
      keywords: ['multi'],
    })

    retrieveRelevantMemories('multi')
    retrieveRelevantMemories('multi')

    const updated = getMemory(entry.id)
    expect(updated!.accessCount).toBe(2)
  })

  it('ranks non-matching entries lower than matching ones', () => {
    addMemory('unrelated content', 'lesson', source, {
      keywords: ['unrelated'],
      confidence: 0.5,
    })
    const matchId = addMemory('typescript patterns', 'lesson', source, {
      keywords: ['typescript'],
      confidence: 0.5,
    }).id

    const results = retrieveRelevantMemories('typescript')
    // Matching entry should rank first
    expect(results[0]!.id).toBe(matchId)
  })
})
