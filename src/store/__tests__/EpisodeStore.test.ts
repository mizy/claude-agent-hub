import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'fs'
import {
  saveEpisode,
  getEpisode,
  deleteEpisode,
  listEpisodes,
  searchEpisodes,
  getEpisodesByTimeRange,
} from '../EpisodeStore.js'
import { EPISODES_DIR } from '../paths.js'
import type { Episode } from '../../memory/types.js'

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: `episode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    participants: ['user1'],
    turnCount: 5,
    summary: 'Test episode summary',
    keyDecisions: ['decision-1'],
    tone: 'technical',
    relatedMemories: [],
    platform: 'cli',
    triggerKeywords: ['test', 'episode'],
    ...overrides,
  }
}

function clearEpisodes() {
  if (existsSync(EPISODES_DIR)) {
    rmSync(EPISODES_DIR, { recursive: true, force: true })
  }
  mkdirSync(EPISODES_DIR, { recursive: true })
}

describe('EpisodeStore', () => {
  beforeEach(clearEpisodes)

  describe('save and get', () => {
    it('saves and retrieves an episode', () => {
      const ep = makeEpisode({ id: 'episode-save-test' })
      saveEpisode(ep)

      const loaded = getEpisode('episode-save-test')
      expect(loaded).not.toBeNull()
      expect(loaded!.summary).toBe('Test episode summary')
      expect(loaded!.tone).toBe('technical')
    })

    it('returns null for non-existent episode', () => {
      expect(getEpisode('non-existent')).toBeNull()
    })
  })

  describe('index auto-update', () => {
    it('updates index on save', () => {
      const ep = makeEpisode({ id: 'episode-index-1' })
      saveEpisode(ep)

      const index = listEpisodes()
      expect(index.length).toBe(1)
      expect(index[0]!.id).toBe('episode-index-1')
    })

    it('maintains sorted order (newest first)', () => {
      const older = makeEpisode({
        id: 'episode-older',
        timestamp: '2025-01-01T00:00:00.000Z',
      })
      const newer = makeEpisode({
        id: 'episode-newer',
        timestamp: '2025-06-01T00:00:00.000Z',
      })

      saveEpisode(older)
      saveEpisode(newer)

      const index = listEpisodes()
      expect(index[0]!.id).toBe('episode-newer')
      expect(index[1]!.id).toBe('episode-older')
    })

    it('removes from index on delete', () => {
      const ep = makeEpisode({ id: 'episode-delete-test' })
      saveEpisode(ep)
      expect(listEpisodes().length).toBe(1)

      deleteEpisode('episode-delete-test')
      expect(listEpisodes().length).toBe(0)
      expect(getEpisode('episode-delete-test')).toBeNull()
    })
  })

  describe('searchEpisodes', () => {
    it('finds episodes by keyword', () => {
      saveEpisode(makeEpisode({
        id: 'ep-backend',
        triggerKeywords: ['backend', 'api', 'node'],
        summary: 'Discussed backend architecture',
      }))
      saveEpisode(makeEpisode({
        id: 'ep-frontend',
        triggerKeywords: ['frontend', 'react', 'css'],
        summary: 'Discussed frontend styling',
      }))

      const results = searchEpisodes('backend')
      expect(results.length).toBe(1)
      expect(results[0]!.id).toBe('ep-backend')
    })

    it('finds episodes by summary content', () => {
      saveEpisode(makeEpisode({
        id: 'ep-deploy',
        triggerKeywords: ['deploy'],
        summary: 'Configured Docker deployment pipeline',
      }))

      const results = searchEpisodes('Docker')
      expect(results.length).toBe(1)
    })

    it('returns empty for no match', () => {
      saveEpisode(makeEpisode({ id: 'ep-1', triggerKeywords: ['foo'] }))
      expect(searchEpisodes('nonexistent')).toEqual([])
    })
  })

  describe('getEpisodesByTimeRange', () => {
    it('filters by time range', () => {
      saveEpisode(makeEpisode({
        id: 'ep-jan',
        timestamp: '2025-01-15T12:00:00.000Z',
      }))
      saveEpisode(makeEpisode({
        id: 'ep-mar',
        timestamp: '2025-03-15T12:00:00.000Z',
      }))
      saveEpisode(makeEpisode({
        id: 'ep-jun',
        timestamp: '2025-06-15T12:00:00.000Z',
      }))

      const results = getEpisodesByTimeRange(
        '2025-02-01T00:00:00.000Z',
        '2025-04-01T00:00:00.000Z',
      )
      expect(results.length).toBe(1)
      expect(results[0]!.id).toBe('ep-mar')
    })
  })
})
