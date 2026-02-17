import { describe, it, expect, vi, beforeEach } from 'vitest'
import { compareVersions } from '../compareVersions.js'
import type { PromptVersion, PromptVersionStats } from '../../types/promptVersion.js'

vi.mock('../../store/PromptVersionStore.js', () => ({
  getPromptVersion: vi.fn(),
}))

import { getPromptVersion } from '../../store/PromptVersionStore.js'

const mockGetVersion = vi.mocked(getPromptVersion)

function makeVersion(
  id: string,
  version: number,
  stats: Partial<PromptVersionStats> = {}
): PromptVersion {
  return {
    id,
    personaName: 'Pragmatist',
    version,
    systemPrompt: 'test prompt',
    changelog: 'test',
    stats: {
      totalTasks: 10,
      successCount: 8,
      failureCount: 2,
      successRate: 0.8,
      avgDurationMs: 60000,
      ...stats,
    },
    status: 'active',
    createdAt: new Date().toISOString(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('compareVersions', () => {
  it('returns null when version not found', () => {
    mockGetVersion.mockReturnValue(null)
    expect(compareVersions('Pragmatist', 'v1', 'v2')).toBeNull()
  })

  it('returns null when second version not found', () => {
    mockGetVersion.mockReturnValueOnce(makeVersion('v1', 1))
    mockGetVersion.mockReturnValueOnce(null)
    expect(compareVersions('Pragmatist', 'v1', 'v2')).toBeNull()
  })

  it('returns insufficient_data when totalTasks < 3', () => {
    mockGetVersion.mockReturnValueOnce(makeVersion('v1', 1, { totalTasks: 2, successRate: 1 }))
    mockGetVersion.mockReturnValueOnce(makeVersion('v2', 2, { totalTasks: 10, successRate: 0.9 }))

    const result = compareVersions('Pragmatist', 'v1', 'v2')
    expect(result).not.toBeNull()
    expect(result!.recommendation).toBe('insufficient_data')
  })

  it('computes diff correctly', () => {
    mockGetVersion.mockReturnValueOnce(
      makeVersion('v1', 1, { successRate: 0.7, avgDurationMs: 50000, totalTasks: 10 })
    )
    mockGetVersion.mockReturnValueOnce(
      makeVersion('v2', 2, { successRate: 0.9, avgDurationMs: 40000, totalTasks: 15 })
    )

    const result = compareVersions('Pragmatist', 'v1', 'v2')!
    expect(result.diff.successRateDelta).toBeCloseTo(0.2)
    expect(result.diff.avgDurationDelta).toBe(-10000)
    expect(result.diff.totalTasksDelta).toBe(5)
  })

  it('returns no_significant_diff when differences are small', () => {
    mockGetVersion.mockReturnValueOnce(
      makeVersion('v1', 1, { successRate: 0.8, avgDurationMs: 60000, totalTasks: 10 })
    )
    mockGetVersion.mockReturnValueOnce(
      makeVersion('v2', 2, { successRate: 0.82, avgDurationMs: 62000, totalTasks: 10 })
    )

    const result = compareVersions('Pragmatist', 'v1', 'v2')!
    expect(result.recommendation).toBe('no_significant_diff')
  })

  it('recommends v2 when it has better stats', () => {
    mockGetVersion.mockReturnValueOnce(
      makeVersion('v1', 1, { successRate: 0.6, avgDurationMs: 100000, totalTasks: 10 })
    )
    mockGetVersion.mockReturnValueOnce(
      makeVersion('v2', 2, { successRate: 0.9, avgDurationMs: 50000, totalTasks: 10 })
    )

    const result = compareVersions('Pragmatist', 'v1', 'v2')!
    expect(result.recommendation).toBe('prefer_v2')
  })

  it('recommends v1 when it has better stats', () => {
    mockGetVersion.mockReturnValueOnce(
      makeVersion('v1', 1, { successRate: 0.95, avgDurationMs: 30000, totalTasks: 10 })
    )
    mockGetVersion.mockReturnValueOnce(
      makeVersion('v2', 2, { successRate: 0.6, avgDurationMs: 100000, totalTasks: 10 })
    )

    const result = compareVersions('Pragmatist', 'v1', 'v2')!
    expect(result.recommendation).toBe('prefer_v1')
  })
})
