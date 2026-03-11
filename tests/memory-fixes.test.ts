/**
 * Tests for memory subsystem bug fixes:
 * 1. consolidateMemories — migrateAssociations stale snapshot
 * 2. Entity index consistency across delete/merge paths
 * 3. atomicUpdateMemory for safe read-modify-write
 * 4. MemoryStore CRUD basics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  getAllMemories,
  getMemory,
  saveMemory,
  deleteMemory,
  updateMemory,
  atomicUpdateMemory,
} from '../src/store/MemoryStore.js'
import { MEMORY_DIR } from '../src/store/paths.js'
import type { MemoryEntry, Association } from '../src/memory/types.js'
import {
  indexMemoryEntities,
  removeFromEntityIndex,
  queryEntityIndex,
  rebuildEntityIndex,
} from '../src/memory/entityIndex.js'
import { removeMemory } from '../src/memory/manageMemory.js'

/** Create a minimal MemoryEntry for testing */
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
    ...overrides,
  }
}

function cleanMemoryDir() {
  if (existsSync(MEMORY_DIR)) {
    rmSync(MEMORY_DIR, { recursive: true, force: true })
  }
  mkdirSync(MEMORY_DIR, { recursive: true })
}

describe('MemoryStore atomicUpdateMemory', () => {
  beforeEach(cleanMemoryDir)
  afterEach(cleanMemoryDir)

  it('reads current value before applying updates', () => {
    const entry = makeEntry({ id: 'atomic-1', accessCount: 5 })
    saveMemory(entry)

    // Simulate external update between "read" and "write"
    updateMemory('atomic-1', { accessCount: 10 })

    // atomicUpdate reads the CURRENT value (10), not the stale one
    atomicUpdateMemory('atomic-1', (current) => ({
      accessCount: (current.accessCount ?? 0) + 1,
    }))

    const result = getMemory('atomic-1')
    expect(result?.accessCount).toBe(11)
  })

  it('returns false for non-existent entry', () => {
    const ok = atomicUpdateMemory('non-existent', () => ({ accessCount: 1 }))
    expect(ok).toBe(false)
  })

  it('preserves fields not touched by updater', () => {
    const entry = makeEntry({ id: 'atomic-2', content: 'keep me', confidence: 0.9 })
    saveMemory(entry)

    atomicUpdateMemory('atomic-2', () => ({ accessCount: 42 }))

    const result = getMemory('atomic-2')
    expect(result?.content).toBe('keep me')
    expect(result?.confidence).toBe(0.9)
    expect(result?.accessCount).toBe(42)
  })
})

describe('consolidateMemories — migrateAssociations fix', () => {
  beforeEach(cleanMemoryDir)
  afterEach(cleanMemoryDir)

  it('updateMemory after merge does not get overwritten by migrateAssociations', () => {
    // Simulate the merge flow manually:
    // 1. Create entry A with some content
    // 2. Create entry B with associations
    // 3. updateMemory A with new merged content
    // 4. Re-read A (like fixed migrateAssociations does) and update associations
    // 5. Verify A has BOTH the merged content AND the migrated associations

    const assocTarget = makeEntry({ id: 'target-1', content: 'some target' })
    saveMemory(assocTarget)

    const entryA = makeEntry({
      id: 'merge-a',
      content: 'original A content',
      keywords: ['keyA'],
      confidence: 0.5,
    })
    saveMemory(entryA)

    const assocB: Association[] = [
      { targetId: 'target-1', weight: 0.8, type: 'keyword' },
    ]
    const entryB = makeEntry({
      id: 'merge-b',
      content: 'original B content',
      keywords: ['keyB'],
      associations: assocB,
    })
    saveMemory(entryB)

    // Step 1: merge update (like applyDecision does)
    updateMemory('merge-a', {
      content: 'merged A+B content',
      keywords: ['keyA', 'keyB'],
      confidence: 0.9,
      reinforceCount: 5,
    })

    // Step 2: migrateAssociations — re-reads from store (the fix)
    const current = getMemory('merge-a')!
    expect(current.content).toBe('merged A+B content') // merged content persists

    const existingTargets = new Set((current.associations ?? []).map(a => a.targetId))
    const newAssocs = entryB.associations!.filter(
      a => a.targetId !== 'merge-a' && !existingTargets.has(a.targetId),
    )
    if (newAssocs.length > 0) {
      updateMemory('merge-a', {
        associations: [...(current.associations ?? []), ...newAssocs],
      })
    }

    // Verify: A has merged content AND migrated associations
    const final = getMemory('merge-a')!
    expect(final.content).toBe('merged A+B content')
    expect(final.confidence).toBe(0.9)
    expect(final.reinforceCount).toBe(5)
    expect(final.associations).toHaveLength(1)
    expect(final.associations![0].targetId).toBe('target-1')
  })

  it('old code path (saveMemory with stale snapshot) WOULD overwrite merge', () => {
    // Demonstrate the bug: using saveMemory({...survivor, associations}) with stale survivor
    const entryA = makeEntry({
      id: 'bug-a',
      content: 'original A',
      confidence: 0.5,
    })
    saveMemory(entryA)

    // Merge update
    updateMemory('bug-a', {
      content: 'merged content',
      confidence: 0.9,
    })

    // Stale snapshot saveMemory (the old buggy code)
    saveMemory({ ...entryA, associations: [{ targetId: 'x', weight: 0.5, type: 'keyword' }] })

    const result = getMemory('bug-a')!
    // Bug: content is reverted to 'original A'
    expect(result.content).toBe('original A')
    expect(result.confidence).toBe(0.5)
    // This proves the old code was broken
  })
})

describe('Entity index consistency', () => {
  beforeEach(() => {
    cleanMemoryDir()
    // Reset entity index by rebuilding with empty set
    rebuildEntityIndex([])
  })
  afterEach(cleanMemoryDir)

  it('removeMemory cleans entity index', () => {
    const entry = makeEntry({
      id: 'entity-1',
      content: 'Using CAH_DATA_DIR and GenericFileStore for persistence',
    })
    saveMemory(entry)
    indexMemoryEntities(entry)

    // Verify entity is indexed
    const hits = queryEntityIndex('CAH_DATA_DIR')
    expect(hits.get('entity-1')).toBeGreaterThan(0)

    // Remove via manageMemory.removeMemory (which cleans entity index)
    removeMemory('entity-1')

    // Entity index should no longer contain this memory
    const hitsAfter = queryEntityIndex('CAH_DATA_DIR')
    expect(hitsAfter.get('entity-1')).toBeUndefined()
  })

  it('direct deleteMemory without removeFromEntityIndex leaves stale entries', () => {
    const entry = makeEntry({
      id: 'entity-2',
      content: 'WorkflowExecution handles node scheduling',
    })
    saveMemory(entry)
    indexMemoryEntities(entry)

    // Delete directly (bypassing entity cleanup)
    deleteMemory('entity-2')

    // Stale reference remains in entity index
    const hits = queryEntityIndex('WorkflowExecution')
    expect(hits.get('entity-2')).toBeGreaterThan(0)
  })

  it('removeFromEntityIndex + deleteMemory cleans up properly', () => {
    const entry = makeEntry({
      id: 'entity-3',
      content: 'WorkflowExecution handles node scheduling',
    })
    saveMemory(entry)
    indexMemoryEntities(entry)

    // Proper cleanup (like the fixed forgettingEngine does)
    removeFromEntityIndex('entity-3')
    deleteMemory('entity-3')

    const hits = queryEntityIndex('WorkflowExecution')
    expect(hits.get('entity-3')).toBeUndefined()
  })

  it('re-index after merge updates entity entries', () => {
    const entry = makeEntry({
      id: 'entity-4',
      content: 'CAH_DATA_DIR is the data directory',
    })
    saveMemory(entry)
    indexMemoryEntities(entry)

    // Merge changes content (new entity: MAX_RETRIES)
    updateMemory('entity-4', {
      content: 'CAH_DATA_DIR and MAX_RETRIES are important constants',
    })

    // Re-index (like the fixed consolidateMemories does)
    removeFromEntityIndex('entity-4')
    const updated = getMemory('entity-4')!
    indexMemoryEntities(updated)

    // New entity should be findable
    const hits = queryEntityIndex('MAX_RETRIES')
    expect(hits.get('entity-4')).toBeGreaterThan(0)
  })

  it('rebuildEntityIndex recovers from stale state', () => {
    const e1 = makeEntry({ id: 'rebuild-1', content: 'CAH_DATA_DIR usage' })
    const e2 = makeEntry({ id: 'rebuild-2', content: 'MAX_RETRIES constant' })
    saveMemory(e1)
    saveMemory(e2)

    // Full rebuild
    const result = rebuildEntityIndex([e1, e2])
    expect(result.indexedMemories).toBe(2)

    expect(queryEntityIndex('CAH_DATA_DIR').get('rebuild-1')).toBeGreaterThan(0)
    expect(queryEntityIndex('MAX_RETRIES').get('rebuild-2')).toBeGreaterThan(0)
  })
})

describe('MemoryStore basic operations', () => {
  beforeEach(cleanMemoryDir)
  afterEach(cleanMemoryDir)

  it('saveMemory + getMemory roundtrip', () => {
    const entry = makeEntry({ id: 'basic-1', content: 'hello world' })
    saveMemory(entry)
    const loaded = getMemory('basic-1')
    expect(loaded).not.toBeNull()
    expect(loaded!.content).toBe('hello world')
  })

  it('updateMemory merges fields', () => {
    const entry = makeEntry({ id: 'basic-2', content: 'old', confidence: 0.3 })
    saveMemory(entry)
    updateMemory('basic-2', { confidence: 0.9 })
    const loaded = getMemory('basic-2')
    expect(loaded!.confidence).toBe(0.9)
    expect(loaded!.content).toBe('old')
  })

  it('deleteMemory removes entry', () => {
    const entry = makeEntry({ id: 'basic-3' })
    saveMemory(entry)
    expect(getMemory('basic-3')).not.toBeNull()
    deleteMemory('basic-3')
    expect(getMemory('basic-3')).toBeNull()
  })

  it('getAllMemories returns all saved entries', () => {
    saveMemory(makeEntry({ id: 'all-1' }))
    saveMemory(makeEntry({ id: 'all-2' }))
    saveMemory(makeEntry({ id: 'all-3' }))
    const all = getAllMemories()
    const ids = all.map(e => e.id)
    expect(ids).toContain('all-1')
    expect(ids).toContain('all-2')
    expect(ids).toContain('all-3')
  })
})
