import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { EPISODES_DIR } from '../../store/paths.js'

// Mock invokeBackend
vi.mock('../../backend/index.js', () => ({
  invokeBackend: vi.fn(),
}))

import { extractEpisode } from '../extractEpisode.js'
import { invokeBackend } from '../../backend/index.js'
import { getEpisode } from '../../store/EpisodeStore.js'
import type { EpisodeMessage } from '../extractEpisode.js'

const mockedInvoke = vi.mocked(invokeBackend)

function clearEpisodes() {
  if (existsSync(EPISODES_DIR)) {
    rmSync(EPISODES_DIR, { recursive: true, force: true })
  }
  mkdirSync(EPISODES_DIR, { recursive: true })
}

const sampleMessages: EpisodeMessage[] = [
  { role: 'user', content: '帮我看看 backend 的代码架构' },
  { role: 'assistant', content: '好的，我来分析一下后端架构...' },
  { role: 'user', content: '那我们用 Express 还是 Fastify？' },
  { role: 'assistant', content: '推荐使用 Fastify，性能更好...' },
]

describe('extractEpisode', () => {
  beforeEach(() => {
    clearEpisodes()
    vi.clearAllMocks()
  })

  it('extracts episode from conversation via LLM', async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      value: {
        response: JSON.stringify({
          summary: '讨论了后端框架选型，最终决定使用 Fastify',
          keyDecisions: ['选择 Fastify 作为后端框架'],
          tone: 'technical',
          triggerKeywords: ['backend', 'fastify', 'express', '框架选型'],
        }),
        durationMs: 1000,
      },
    } as any)

    const episode = await extractEpisode({
      messages: sampleMessages,
      platform: 'lark',
      participants: ['user1'],
    })

    expect(episode).not.toBeNull()
    expect(episode!.summary).toContain('Fastify')
    expect(episode!.keyDecisions).toHaveLength(1)
    expect(episode!.tone).toBe('technical')
    expect(episode!.platform).toBe('lark')
    expect(episode!.triggerKeywords).toContain('backend')
    expect(episode!.turnCount).toBe(4)

    // Verify saved to store
    const stored = getEpisode(episode!.id)
    expect(stored).not.toBeNull()
    expect(stored!.summary).toBe(episode!.summary)
  })

  it('generates episode ID in correct format', async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      value: {
        response: JSON.stringify({
          summary: 'test',
          keyDecisions: [],
          tone: 'casual',
          triggerKeywords: ['test'],
        }),
        durationMs: 500,
      },
    } as any)

    const episode = await extractEpisode({
      messages: sampleMessages,
      platform: 'cli',
    })

    expect(episode!.id).toMatch(/^episode-\d+-[a-z0-9]+$/)
  })

  it('defaults to technical tone for invalid tone value', async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      value: {
        response: JSON.stringify({
          summary: 'test',
          keyDecisions: [],
          tone: 'invalid-tone',
          triggerKeywords: [],
        }),
        durationMs: 500,
      },
    } as any)

    const episode = await extractEpisode({
      messages: sampleMessages,
      platform: 'cli',
    })

    expect(episode!.tone).toBe('technical')
  })

  it('returns null when messages too short', async () => {
    const result = await extractEpisode({
      messages: [{ role: 'user', content: 'hi' }],
      platform: 'cli',
    })
    expect(result).toBeNull()
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('returns null on LLM failure', async () => {
    mockedInvoke.mockResolvedValue({
      ok: false,
      error: { message: 'timeout' },
    } as any)

    const result = await extractEpisode({
      messages: sampleMessages,
      platform: 'cli',
    })
    expect(result).toBeNull()
  })

  it('returns null on unparseable LLM response', async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      value: { response: 'not json at all', durationMs: 500 },
    } as any)

    const result = await extractEpisode({
      messages: sampleMessages,
      platform: 'cli',
    })
    expect(result).toBeNull()
  })

  it('links relatedMemoryIds when provided', async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      value: {
        response: JSON.stringify({
          summary: 'test',
          keyDecisions: [],
          tone: 'technical',
          triggerKeywords: ['test'],
        }),
        durationMs: 500,
      },
    } as any)

    const episode = await extractEpisode({
      messages: sampleMessages,
      platform: 'lark',
      relatedMemoryIds: ['mem-1', 'mem-2'],
    })

    expect(episode!.relatedMemories).toEqual(['mem-1', 'mem-2'])
  })
})
