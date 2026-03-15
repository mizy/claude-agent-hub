/**
 * Tests for Phase 3: MemScene user model
 * - classifyDomain keyword matching
 * - updateMemScene merge logic
 * - buildMemSceneSummary output format
 * - formatMemoriesForPrompt MemScene injection
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { classifyDomain, updateMemScene, buildMemSceneSummary } from '../src/memory/memScene.js'
import { formatMemoriesForPrompt, formatMemSceneSection } from '../src/memory/formatMemory.js'
import { saveMemScene, getMemScene, getAllMemScenes } from '../src/store/MemSceneStore.js'
import { saveMemory } from '../src/store/MemoryStore.js'
import { rmSync, existsSync } from 'fs'
import { join } from 'path'
import type { MemScene, MemoryEntry } from '../src/memory/types.js'

// Clean memscene dir between tests
const DATA_DIR = process.env.CAH_DATA_DIR!
const MEMSCENE_DIR = join(DATA_DIR, 'memscene')
const MEMORY_DIR = join(DATA_DIR, 'memory')

function cleanDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

function makeMemory(id: string, content: string): MemoryEntry {
  const now = new Date().toISOString()
  return {
    id,
    content,
    category: 'preference',
    keywords: ['test'],
    source: { type: 'manual' },
    confidence: 0.8,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
  }
}

describe('classifyDomain', () => {
  it('matches fund domain keywords', async () => {
    expect(await classifyDomain('我的基金持仓怎么样')).toBe('fund')
  })

  it('matches health domain keywords', async () => {
    expect(await classifyDomain('左侧疼痛怎么缓解')).toBe('health')
  })

  it('matches work domain keywords', async () => {
    expect(await classifyDomain('flex 的 PR deploy 状态')).toBe('work')
  })

  it('matches code domain keywords', async () => {
    expect(await classifyDomain('这个 bug 怎么修？需要重构')).toBe('code')
  })

  it('returns null for no match', async () => {
    expect(await classifyDomain('今天天气不错')).toBeNull()
  })

  it('picks domain with most keyword hits', async () => {
    // "基金收益净值" has 3 fund keywords vs 0 for others
    expect(await classifyDomain('基金收益净值分析')).toBe('fund')
  })
})

describe('updateMemScene', () => {
  beforeEach(() => {
    cleanDir(MEMSCENE_DIR)
  })

  it('creates new MemScene for a domain', () => {
    const scene = updateMemScene('fund', {
      factIds: ['fact-1', 'fact-2'],
      memoryIds: ['mem-1'],
    })
    expect(scene.domain).toBe('fund')
    expect(scene.factIds).toEqual(['fact-1', 'fact-2'])
    expect(scene.memoryIds).toEqual(['mem-1'])
    expect(scene.episodeIds).toEqual([])
    expect(scene.summary).toContain('fund')
    expect(scene.summary).toContain('2条事实')
    expect(scene.summary).toContain('1条记忆')
  })

  it('merges IDs with existing MemScene (deduped)', () => {
    updateMemScene('fund', { factIds: ['fact-1', 'fact-2'], memoryIds: ['mem-1'] })
    const scene = updateMemScene('fund', { factIds: ['fact-2', 'fact-3'], episodeIds: ['ep-1'] })
    expect(scene.factIds).toEqual(['fact-1', 'fact-2', 'fact-3'])
    expect(scene.memoryIds).toEqual(['mem-1'])
    expect(scene.episodeIds).toEqual(['ep-1'])
  })

  it('persists to store', () => {
    updateMemScene('health', { memoryIds: ['mem-h1'] })
    const stored = getMemScene('health')
    expect(stored).not.toBeNull()
    expect(stored!.domain).toBe('health')
    expect(stored!.memoryIds).toEqual(['mem-h1'])
  })
})

describe('buildMemSceneSummary', () => {
  beforeEach(() => {
    cleanDir(MEMSCENE_DIR)
    cleanDir(MEMORY_DIR)
  })

  it('returns summary from linked memories', () => {
    saveMemory(makeMemory('mem-s1', '用户偏好低风险基金'))
    saveMemory(makeMemory('mem-s2', '持有中银国有企业债A'))

    const scene: MemScene = {
      domain: 'fund',
      summary: '[fund] 2条记忆',
      factIds: [],
      memoryIds: ['mem-s1', 'mem-s2'],
      episodeIds: [],
      updatedAt: new Date().toISOString(),
    }

    const result = buildMemSceneSummary(scene)
    expect(result).toContain('[fund]')
    expect(result).toContain('用户偏好低风险基金')
    expect(result).toContain('持有中银国有企业债A')
  })

  it('falls back to scene.summary when no memories found', () => {
    const scene: MemScene = {
      domain: 'fund',
      summary: '[fund] 2条事实',
      factIds: ['fact-missing'],
      memoryIds: [],
      episodeIds: [],
      updatedAt: new Date().toISOString(),
    }
    expect(buildMemSceneSummary(scene)).toBe('[fund] 2条事实')
  })

  it('truncates to ~200 chars', () => {
    const longContent = 'A'.repeat(150)
    saveMemory(makeMemory('mem-long1', longContent))
    saveMemory(makeMemory('mem-long2', longContent))

    const scene: MemScene = {
      domain: 'fund',
      summary: '[fund] test',
      factIds: [],
      memoryIds: ['mem-long1', 'mem-long2'],
      episodeIds: [],
      updatedAt: new Date().toISOString(),
    }

    const result = buildMemSceneSummary(scene)
    expect(result.length).toBeLessThanOrEqual(200)
  })
})

describe('formatMemSceneSection', () => {
  it('returns empty string for no scenes', () => {
    expect(formatMemSceneSection([])).toBe('')
  })

  it('formats scenes as user profile', () => {
    const scenes: MemScene[] = [
      {
        domain: 'fund',
        summary: '[fund] 3条事实、2条记忆',
        factIds: [],
        memoryIds: [],
        episodeIds: [],
        updatedAt: new Date().toISOString(),
      },
    ]
    const result = formatMemSceneSection(scenes)
    expect(result).toContain('[用户快照]')
    expect(result).toContain('fund()')
  })
})

describe('formatMemoriesForPrompt with MemScene', () => {
  it('injects MemScene before semantic memories', () => {
    const scenes: MemScene[] = [
      {
        domain: 'fund',
        summary: '[fund] 用户画像摘要',
        factIds: [],
        memoryIds: [],
        episodeIds: [],
        updatedAt: new Date().toISOString(),
      },
    ]
    const memories: MemoryEntry[] = [makeMemory('m1', '测试记忆内容')]

    const result = formatMemoriesForPrompt(memories, scenes)
    const memScenePos = result.indexOf('[用户快照]')
    const semanticPos = result.indexOf('### 偏好设置')
    expect(memScenePos).toBeGreaterThanOrEqual(0)
    expect(semanticPos).toBeGreaterThan(memScenePos)
  })

  it('works without MemScene (backward compatible)', () => {
    const memories: MemoryEntry[] = [makeMemory('m2', '某个模式记忆')]
    const result = formatMemoriesForPrompt(memories)
    expect(result).not.toContain('[用户画像]')
    expect(result).toContain('某个模式记忆')
  })
})
