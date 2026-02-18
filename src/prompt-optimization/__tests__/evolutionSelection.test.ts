import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PromptVersion } from '../../types/promptVersion.js'
import type { Task } from '../../types/task.js'

// Shared state for mock store
const versions = new Map<string, PromptVersion>()
const retiredIds: string[] = []

// Mock PromptVersionStore
vi.mock('../../store/PromptVersionStore.js', () => ({
  getAllVersions: vi.fn((persona: string) => {
    return [...versions.values()]
      .filter(v => v.personaName === persona)
      .sort((a, b) => b.version - a.version)
  }),
  getActiveVersion: vi.fn((persona: string) => {
    for (const v of versions.values()) {
      if (v.personaName === persona && v.status === 'active') return v
    }
    return null
  }),
  getPromptVersion: vi.fn((_p: string, id: string) => versions.get(id) ?? null),
  retireVersion: vi.fn((_p: string, id: string) => {
    const v = versions.get(id)
    if (v) {
      v.status = 'retired'
      retiredIds.push(id)
      return true
    }
    return false
  }),
  rollbackToVersion: vi.fn(),
}))

// Mock abTesting
vi.mock('../abTesting.js', () => ({
  getRunningTest: vi.fn(() => null),
  evaluateABTest: vi.fn(() => null),
  concludeABTest: vi.fn(),
}))

// Mock extractSuccessPattern
vi.mock('../extractSuccessPattern.js', () => ({
  extractSuccessPatterns: vi.fn(() => []),
  savePattern: vi.fn(),
  getAllPatterns: vi.fn(() => []),
}))

// Mock failureKnowledgeBase
vi.mock('../failureKnowledgeBase.js', () => ({
  computeFailureStats: vi.fn(() => ({
    totalFailures: 0,
    byCategory: {},
    topPatterns: [],
    recentTrend: 'stable' as const,
  })),
}))

// Import after mocks are set up
import { runEvolutionCycle, refreshSuccessPatterns } from '../evolutionSelection.js'
import * as abTesting from '../abTesting.js'
import * as successPattern from '../extractSuccessPattern.js'

function makeVersion(
  id: string,
  persona: string,
  version: number,
  status: 'active' | 'candidate' | 'retired',
  daysOld = 0
): PromptVersion {
  return {
    id,
    personaName: persona,
    version,
    systemPrompt: 'test prompt',
    changelog: 'test',
    stats: {
      totalTasks: 5,
      successCount: 4,
      failureCount: 1,
      successRate: 0.8,
      avgDurationMs: 60000,
    },
    status,
    createdAt: new Date(Date.now() - daysOld * 86400_000).toISOString(),
  }
}

beforeEach(() => {
  versions.clear()
  retiredIds.length = 0
  vi.clearAllMocks()
})

describe('runEvolutionCycle', () => {
  it('returns report with no versions', () => {
    const report = runEvolutionCycle('Pragmatist')
    expect(report.personaName).toBe('Pragmatist')
    expect(report.activeVersion).toBeNull()
    expect(report.candidateVersions).toBe(0)
    expect(report.retiredVersions).toBe(0)
    expect(report.failureTrend).toBe('stable')
  })

  it('returns report with active version', () => {
    versions.set('pv-1', makeVersion('pv-1', 'Pragmatist', 1, 'active'))

    const report = runEvolutionCycle('Pragmatist')
    expect(report.activeVersion).toEqual({
      id: 'pv-1',
      version: 1,
      successRate: 0.8,
      totalTasks: 5,
    })
  })

  it('retires stale candidates older than 7 days', () => {
    versions.set('pv-1', makeVersion('pv-1', 'Pragmatist', 1, 'active'))
    versions.set('pv-2', makeVersion('pv-2', 'Pragmatist', 2, 'candidate', 10)) // 10 days old
    versions.set('pv-3', makeVersion('pv-3', 'Pragmatist', 3, 'candidate', 2)) // 2 days old (fresh)

    const report = runEvolutionCycle('Pragmatist')
    expect(retiredIds).toContain('pv-2')
    expect(retiredIds).not.toContain('pv-3')
    expect(report.candidateVersions).toBe(1)
  })

  it('does not retire candidates in running A/B tests', () => {
    vi.mocked(abTesting.getRunningTest).mockReturnValue({
      id: 'ab-1',
      personaName: 'Pragmatist',
      controlVersionId: 'pv-1',
      candidateVersionId: 'pv-2',
      status: 'running',
      minSamples: 5,
      createdAt: new Date().toISOString(),
    })

    versions.set('pv-1', makeVersion('pv-1', 'Pragmatist', 1, 'active'))
    versions.set('pv-2', makeVersion('pv-2', 'Pragmatist', 2, 'candidate', 10))

    runEvolutionCycle('Pragmatist')
    expect(retiredIds).not.toContain('pv-2')
  })

  it('concludes ready A/B tests', () => {
    vi.mocked(abTesting.getRunningTest).mockReturnValue({
      id: 'ab-1',
      personaName: 'Pragmatist',
      controlVersionId: 'pv-1',
      candidateVersionId: 'pv-2',
      status: 'running',
      minSamples: 5,
      createdAt: new Date().toISOString(),
    })
    vi.mocked(abTesting.evaluateABTest).mockReturnValue({
      winner: 'candidate',
      controlStats: { totalTasks: 5, successCount: 3, failureCount: 2, successRate: 0.6, avgDurationMs: 60000 },
      candidateStats: { totalTasks: 5, successCount: 4, failureCount: 1, successRate: 0.8, avgDurationMs: 50000 },
      fitnessControl: 0.6,
      fitnessCandidate: 0.8,
      recommendation: 'Promote candidate',
    })

    versions.set('pv-1', makeVersion('pv-1', 'Pragmatist', 1, 'active'))
    versions.set('pv-2', makeVersion('pv-2', 'Pragmatist', 2, 'candidate'))

    runEvolutionCycle('Pragmatist')
    expect(abTesting.concludeABTest).toHaveBeenCalledWith('ab-1')
  })
})

describe('refreshSuccessPatterns', () => {
  it('returns 0 when no patterns extracted', () => {
    const count = refreshSuccessPatterns([])
    expect(count).toBe(0)
  })

  it('saves patterns with sufficient sample count', () => {
    vi.mocked(successPattern.extractSuccessPatterns).mockReturnValue([
      { id: 'sp-1', sampleCount: 3, taskType: 'testing', nodeSequence: [], agentAssignments: {}, avgDuration: 0, confidence: 0.6, extractedAt: '' },
      { id: 'sp-2', sampleCount: 1, taskType: 'feature', nodeSequence: [], agentAssignments: {}, avgDuration: 0, confidence: 0.2, extractedAt: '' },
    ])

    const count = refreshSuccessPatterns([{ id: 'task-1', status: 'completed' }] as unknown as Task[])
    expect(count).toBe(1)
    expect(successPattern.savePattern).toHaveBeenCalledWith(expect.objectContaining({ id: 'sp-1' }))
    expect(successPattern.savePattern).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'sp-2' }))
  })
})
