import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { EPISODES_DIR } from '../../store/paths.js'
import { saveEpisode } from '../../store/EpisodeStore.js'
import { retrieveEpisodes } from '../retrieveEpisode.js'
import type { Episode } from '../types.js'

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: `episode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    participants: ['user1'],
    turnCount: 5,
    summary: 'Default summary',
    keyDecisions: [],
    tone: 'technical',
    relatedMemories: [],
    platform: 'cli',
    triggerKeywords: [],
    ...overrides,
  }
}

function clearEpisodes() {
  if (existsSync(EPISODES_DIR)) {
    rmSync(EPISODES_DIR, { recursive: true, force: true })
  }
  mkdirSync(EPISODES_DIR, { recursive: true })
}

describe('retrieveEpisodes', () => {
  beforeEach(clearEpisodes)

  it('returns empty array when no episodes exist', () => {
    const results = retrieveEpisodes({ query: 'anything' })
    expect(results).toEqual([])
  })

  it('retrieves episodes by keyword match', () => {
    saveEpisode(makeEpisode({
      id: 'ep-backend-1',
      triggerKeywords: ['backend', 'api', 'architecture'],
      summary: 'Backend architecture discussion',
    }))
    saveEpisode(makeEpisode({
      id: 'ep-frontend-1',
      triggerKeywords: ['frontend', 'react', 'css'],
      summary: 'Frontend styling discussion',
    }))

    const results = retrieveEpisodes({ query: 'backend讨论' })
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.id).toBe('ep-backend-1')
  })

  it('retrieves episodes by time expression "昨天"', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(12, 0, 0, 0)

    saveEpisode(makeEpisode({
      id: 'ep-yesterday',
      timestamp: yesterday.toISOString(),
      triggerKeywords: ['deploy'],
    }))

    // Old episode (30 days ago)
    const old = new Date()
    old.setDate(old.getDate() - 30)
    saveEpisode(makeEpisode({
      id: 'ep-old',
      timestamp: old.toISOString(),
      triggerKeywords: ['deploy'],
    }))

    const results = retrieveEpisodes({ query: '昨天' })
    // Should find yesterday's episode (time-filtered)
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(r => r.id === 'ep-yesterday')).toBe(true)
  })

  it('scores higher for recent episodes', () => {
    const recent = new Date()
    recent.setHours(recent.getHours() - 1)
    saveEpisode(makeEpisode({
      id: 'ep-recent',
      timestamp: recent.toISOString(),
      triggerKeywords: ['test', 'vitest'],
    }))

    const old = new Date()
    old.setDate(old.getDate() - 14)
    saveEpisode(makeEpisode({
      id: 'ep-old',
      timestamp: old.toISOString(),
      triggerKeywords: ['test', 'vitest'],
    }))

    const results = retrieveEpisodes({ query: 'test vitest' })
    expect(results.length).toBe(2)
    expect(results[0]!.id).toBe('ep-recent')
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score)
  })

  it('boosts score for semantic link (relatedMemories overlap)', () => {
    saveEpisode(makeEpisode({
      id: 'ep-linked',
      triggerKeywords: ['deploy'],
      relatedMemories: ['mem-123', 'mem-456'],
    }))
    saveEpisode(makeEpisode({
      id: 'ep-unlinked',
      triggerKeywords: ['deploy'],
      relatedMemories: [],
    }))

    const results = retrieveEpisodes({
      query: 'deploy',
      currentMemoryIds: ['mem-123'],
    })
    expect(results.length).toBe(2)
    // Linked episode should score higher
    const linked = results.find(r => r.id === 'ep-linked')!
    const unlinked = results.find(r => r.id === 'ep-unlinked')!
    expect(linked.score).toBeGreaterThan(unlinked.score)
  })

  it('respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      saveEpisode(makeEpisode({
        id: `ep-limit-${i}`,
        triggerKeywords: ['common'],
      }))
    }

    const results = retrieveEpisodes({ query: 'common', limit: 2 })
    expect(results.length).toBe(2)
  })

  it('filters out very low score episodes (no keyword overlap)', () => {
    // 90 days old + no keyword overlap → time recency alone is very small
    saveEpisode(makeEpisode({
      id: 'ep-no-match',
      timestamp: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      triggerKeywords: ['完全不相关的关键词'],
      relatedMemories: [],
    }))

    const results = retrieveEpisodes({ query: 'xyz123 abc456 nevermatches' })
    // With no keyword overlap, no semantic link, and 90-day old timestamp,
    // score should be below 0.01 threshold
    expect(results.length).toBe(0)
  })
})
