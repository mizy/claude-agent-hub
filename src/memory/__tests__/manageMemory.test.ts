import { describe, it, expect, beforeEach } from 'vitest'
import { addMemory, listMemories, removeMemory, searchMemories } from '../manageMemory.js'
import { getAllMemories } from '../../store/MemoryStore.js'
import type { MemorySource } from '../types.js'

const source: MemorySource = { type: 'manual' }

function clearAll() {
  for (const m of getAllMemories()) {
    removeMemory(m.id)
  }
}

describe('addMemory', () => {
  beforeEach(clearAll)

  it('creates entry with defaults', () => {
    const entry = addMemory('vitest is fast', 'lesson', source)
    expect(entry.id).toBeTruthy()
    expect(entry.content).toBe('vitest is fast')
    expect(entry.category).toBe('lesson')
    expect(entry.confidence).toBe(0.5)
    expect(entry.accessCount).toBe(0)
    expect(entry.keywords.length).toBeGreaterThan(0)
  })

  it('uses custom keywords and confidence', () => {
    const entry = addMemory('custom entry', 'pattern', source, {
      keywords: ['custom', 'test'],
      confidence: 0.9,
    })
    expect(entry.keywords).toEqual(['custom', 'test'])
    expect(entry.confidence).toBe(0.9)
  })

  it('persists to store', () => {
    addMemory('persisted', 'tool', source)
    const all = getAllMemories()
    expect(all.some(m => m.content === 'persisted')).toBe(true)
  })

  it('sets projectPath when provided', () => {
    const entry = addMemory('project specific', 'pattern', source, {
      projectPath: '/some/project',
    })
    expect(entry.projectPath).toBe('/some/project')
  })
})

describe('listMemories', () => {
  beforeEach(clearAll)

  it('returns empty array when no memories', () => {
    expect(listMemories()).toEqual([])
  })

  it('returns all memories without filter', () => {
    addMemory('a', 'lesson', source)
    addMemory('b', 'pattern', source)
    expect(listMemories()).toHaveLength(2)
  })

  it('filters by category', () => {
    addMemory('lesson1', 'lesson', source)
    addMemory('pattern1', 'pattern', source)
    addMemory('lesson2', 'lesson', source)

    const lessons = listMemories({ category: 'lesson' })
    expect(lessons).toHaveLength(2)
    expect(lessons.every(m => m.category === 'lesson')).toBe(true)
  })

  it('filters by projectPath', () => {
    addMemory('a', 'lesson', source, { projectPath: '/proj-a' })
    addMemory('b', 'lesson', source, { projectPath: '/proj-b' })
    addMemory('c', 'pattern', source)

    const result = listMemories({ projectPath: '/proj-a' })
    expect(result).toHaveLength(1)
    expect(result[0]!.content).toBe('a')
  })

  it('filters by both category and projectPath', () => {
    addMemory('match', 'lesson', source, { projectPath: '/proj' })
    addMemory('wrong-cat', 'pattern', source, { projectPath: '/proj' })
    addMemory('wrong-proj', 'lesson', source, { projectPath: '/other' })

    const result = listMemories({ category: 'lesson', projectPath: '/proj' })
    expect(result).toHaveLength(1)
    expect(result[0]!.content).toBe('match')
  })
})

describe('removeMemory', () => {
  beforeEach(clearAll)

  it('removes existing entry', () => {
    const entry = addMemory('to delete', 'lesson', source)
    expect(removeMemory(entry.id)).toBe(true)
    expect(listMemories()).toHaveLength(0)
  })

  it('returns false for non-existent id', () => {
    expect(removeMemory('nonexistent-id')).toBe(false)
  })
})

describe('searchMemories', () => {
  beforeEach(clearAll)

  it('finds by keyword match', () => {
    addMemory('vitest is great for testing', 'lesson', source, {
      keywords: ['vitest', 'testing'],
    })
    addMemory('react hooks pattern', 'pattern', source, {
      keywords: ['react', 'hooks'],
    })

    const results = searchMemories('vitest')
    expect(results).toHaveLength(1)
    expect(results[0]!.content).toContain('vitest')
  })

  it('finds by content match', () => {
    addMemory('always use pnpm for this project', 'preference', source, {
      keywords: ['pnpm', 'project'],
    })

    const results = searchMemories('pnpm')
    expect(results.length).toBeGreaterThan(0)
  })

  it('returns empty for no match', () => {
    addMemory('something else', 'lesson', source, { keywords: ['else'] })
    const results = searchMemories('nonexistentkeyword')
    expect(results).toHaveLength(0)
  })

  it('returns empty for empty query keywords', () => {
    addMemory('something', 'lesson', source)
    // extractKeywords strips short/stop words; a single stop word yields []
    const results = searchMemories('a')
    expect(results).toHaveLength(0)
  })
})
