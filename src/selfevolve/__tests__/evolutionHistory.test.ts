import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordEvolution,
  getEvolution,
  updateEvolution,
  listEvolutions,
  getLatestEvolution,
  generateEvolutionId,
  resetStore,
} from '../evolutionHistory.js'
import type { EvolutionRecord } from '../types.js'

function makeRecord(id: string, overrides?: Partial<EvolutionRecord>): EvolutionRecord {
  return {
    id,
    status: 'completed',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    trigger: 'manual',
    patterns: [],
    improvements: [],
    ...overrides,
  }
}

describe('evolutionHistory', () => {
  beforeEach(() => {
    resetStore(true)
  })

  it('generates unique evolution IDs', () => {
    const id1 = generateEvolutionId()
    const id2 = generateEvolutionId()
    expect(id1).toMatch(/^evo-/)
    expect(id2).toMatch(/^evo-/)
    expect(id1).not.toBe(id2)
  })

  it('records and retrieves evolution', () => {
    const record = makeRecord('evo-test-1')
    recordEvolution(record)
    const retrieved = getEvolution('evo-test-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe('evo-test-1')
    expect(retrieved!.status).toBe('completed')
  })

  it('returns null for non-existent record', () => {
    expect(getEvolution('evo-nonexistent')).toBeNull()
  })

  it('updates existing record', () => {
    const record = makeRecord('evo-update')
    recordEvolution(record)

    updateEvolution('evo-update', { status: 'failed', error: 'test error' })
    const updated = getEvolution('evo-update')
    expect(updated!.status).toBe('failed')
    expect(updated!.error).toBe('test error')
  })

  it('update is no-op for non-existent record', () => {
    // Should not throw
    updateEvolution('evo-missing', { status: 'failed' })
  })

  it('lists all records sorted by startedAt (newest first)', () => {
    recordEvolution(makeRecord('evo-a', { startedAt: '2025-01-01T00:00:00Z' }))
    recordEvolution(makeRecord('evo-b', { startedAt: '2025-06-01T00:00:00Z' }))
    recordEvolution(makeRecord('evo-c', { startedAt: '2025-03-01T00:00:00Z' }))

    const list = listEvolutions()
    expect(list).toHaveLength(3)
    expect(list[0]!.id).toBe('evo-b')
    expect(list[1]!.id).toBe('evo-c')
    expect(list[2]!.id).toBe('evo-a')
  })

  it('getLatestEvolution returns newest', () => {
    recordEvolution(makeRecord('evo-old', { startedAt: '2025-01-01T00:00:00Z' }))
    recordEvolution(makeRecord('evo-new', { startedAt: '2025-12-01T00:00:00Z' }))

    const latest = getLatestEvolution()
    expect(latest!.id).toBe('evo-new')
  })

  it('getLatestEvolution returns null when empty', () => {
    expect(getLatestEvolution()).toBeNull()
  })
})
