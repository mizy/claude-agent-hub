import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('../analyzeTaskPatterns.js', () => ({
  analyzeTaskPatterns: vi.fn().mockReturnValue({
    totalExamined: 0,
    patterns: [],
    personaBreakdown: {},
  }),
}))
vi.mock('../analyzePerformance.js', () => ({
  analyzePerformance: vi.fn().mockReturnValue({
    totalExamined: 0,
    avgDurationMs: 0,
    avgCostUsd: 0,
    successRate: 0,
    patterns: [],
    nodeHotspots: [],
  }),
}))
vi.mock('../reviewImprovement.js', () => ({
  reviewImprovements: vi.fn().mockResolvedValue([]),
}))
vi.mock('../applyImprovements.js', () => ({
  applyImprovements: vi.fn().mockResolvedValue([]),
}))
vi.mock('../evolutionHistory.js', () => ({
  generateEvolutionId: vi.fn().mockReturnValue('evo-test-123'),
  recordEvolution: vi.fn(),
  updateEvolution: vi.fn(),
}))
vi.mock('../../prompt-optimization/evolutionSelection.js', () => ({
  refreshSuccessPatterns: vi.fn().mockReturnValue(0),
}))
vi.mock('../../store/TaskStore.js', () => ({
  getTasksByStatus: vi.fn().mockReturnValue([]),
}))

import { runEvolutionCycle } from '../runEvolution.js'
import { analyzeTaskPatterns } from '../analyzeTaskPatterns.js'
import { analyzePerformance } from '../analyzePerformance.js'
import { reviewImprovements } from '../reviewImprovement.js'
import { applyImprovements } from '../applyImprovements.js'
import { generateEvolutionId, recordEvolution, updateEvolution } from '../evolutionHistory.js'
import { getTasksByStatus } from '../../store/TaskStore.js'
import type { FailurePattern, PerformancePattern } from '../types.js'

describe('runEvolutionCycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Re-set defaults after restore
    vi.mocked(analyzeTaskPatterns).mockReturnValue({
      totalExamined: 0,
      patterns: [],
      personaBreakdown: {},
    })
    vi.mocked(analyzePerformance).mockReturnValue({
      totalExamined: 0,
      avgDurationMs: 0,
      avgCostUsd: 0,
      successRate: 0,
      patterns: [],
      nodeHotspots: [],
    })
    vi.mocked(reviewImprovements).mockResolvedValue([])
    vi.mocked(applyImprovements).mockResolvedValue([])
    vi.mocked(generateEvolutionId).mockReturnValue('evo-test-123')
    vi.mocked(recordEvolution).mockImplementation(() => {})
    vi.mocked(updateEvolution).mockImplementation(() => {})
    vi.mocked(getTasksByStatus).mockReturnValue([])
  })

  it('completes with no changes when no patterns found', async () => {
    vi.mocked(analyzeTaskPatterns).mockReturnValue({
      totalExamined: 5,
      patterns: [],
      personaBreakdown: {},
    })

    const result = await runEvolutionCycle()
    expect(result.evolutionId).toBe('evo-test-123')
    expect(result.record.status).toBe('completed')
    expect(result.record.patterns).toHaveLength(0)
    expect(result.record.improvements).toHaveLength(0)
    expect(recordEvolution).toHaveBeenCalledOnce()
    expect(updateEvolution).toHaveBeenCalled()
  })

  it('creates improvements for recurring failure patterns', async () => {
    const pattern: FailurePattern = {
      category: 'prompt',
      description: 'planning failures (patterns: json)',
      occurrences: 3,
      taskIds: ['t1', 't2', 't3'],
      sampleErrors: ['Failed to parse JSON'],
    }
    vi.mocked(analyzeTaskPatterns).mockReturnValue({
      totalExamined: 5,
      patterns: [pattern],
      personaBreakdown: { Pragmatist: { failures: 3, successes: 0, topCategory: 'planning' } },
    })
    // Auto-approve all improvements passed to review
    vi.mocked(reviewImprovements).mockImplementation(async (improvements) => {
      return improvements.map(imp => ({
        improvementId: imp.id,
        review: { approved: true, confidence: 0.9, reasoning: 'good' },
      }))
    })
    vi.mocked(applyImprovements).mockResolvedValue([
      { improvementId: 'imp-1', applied: true, message: 'Generated candidate' },
    ])

    const result = await runEvolutionCycle()
    expect(result.record.status).toBe('completed')
    expect(result.record.patterns).toHaveLength(1)
    expect(result.record.improvements.length).toBeGreaterThan(0)
    expect(reviewImprovements).toHaveBeenCalled()
    expect(applyImprovements).toHaveBeenCalled()
  })

  it('creates improvements from performance patterns', async () => {
    vi.mocked(analyzeTaskPatterns).mockReturnValue({
      totalExamined: 5,
      patterns: [],
      personaBreakdown: {},
    })
    const perfPattern: PerformancePattern = {
      category: 'slow_execution',
      description: '2 tasks took over 2x average',
      severity: 'warning',
      metric: 'totalDurationMs',
      value: 300000,
      threshold: 120000,
      taskIds: ['t1', 't2'],
      suggestion: 'Break large tasks into smaller subtasks',
    }
    vi.mocked(analyzePerformance).mockReturnValue({
      totalExamined: 10,
      avgDurationMs: 60000,
      avgCostUsd: 0.5,
      successRate: 0.8,
      patterns: [perfPattern],
      nodeHotspots: [],
    })
    vi.mocked(reviewImprovements).mockImplementation(async (improvements) => {
      return improvements.map(imp => ({
        improvementId: imp.id,
        review: { approved: true, confidence: 0.8, reasoning: 'ok' },
      }))
    })
    vi.mocked(applyImprovements).mockResolvedValue([])

    const result = await runEvolutionCycle()
    expect(result.record.status).toBe('completed')
    expect(result.record.improvements.length).toBeGreaterThan(0)
    expect(result.record.performanceAnalysis).toBeDefined()
    expect(result.record.performanceAnalysis!.patterns).toHaveLength(1)
  })

  it('skips patterns with only 1 occurrence', async () => {
    const pattern: FailurePattern = {
      category: 'workflow',
      description: 'one-off failure',
      occurrences: 1,
      taskIds: ['t1'],
      sampleErrors: ['Rare error'],
    }
    vi.mocked(analyzeTaskPatterns).mockReturnValue({
      totalExamined: 5,
      patterns: [pattern],
      personaBreakdown: {},
    })

    const result = await runEvolutionCycle()
    expect(result.record.improvements).toHaveLength(0)
    expect(applyImprovements).not.toHaveBeenCalled()
  })

  it('filters out rejected improvements from review', async () => {
    const pattern: FailurePattern = {
      category: 'prompt',
      description: 'repeated failure',
      occurrences: 5,
      taskIds: ['t1', 't2', 't3', 't4', 't5'],
      sampleErrors: ['Error'],
    }
    vi.mocked(analyzeTaskPatterns).mockReturnValue({
      totalExamined: 10,
      patterns: [pattern],
      personaBreakdown: { Pragmatist: { failures: 5, successes: 0, topCategory: 'prompt' } },
    })

    // Review rejects the improvement
    vi.mocked(reviewImprovements).mockImplementation(async (improvements) => {
      return improvements.map(imp => ({
        improvementId: imp.id,
        review: { approved: false, confidence: 0.8, reasoning: 'Too risky' },
      }))
    })

    const result = await runEvolutionCycle()
    expect(result.record.status).toBe('completed')
    // Improvements should be empty since all were rejected
    expect(result.record.improvements).toHaveLength(0)
    expect(result.record.reviewResults).toBeDefined()
    expect(result.record.reviewResults!.length).toBeGreaterThan(0)
    expect(result.record.reviewResults![0]!.review.approved).toBe(false)
    // Should NOT call applyImprovements since nothing approved
    expect(applyImprovements).not.toHaveBeenCalled()
  })

  it('supports dry-run mode (skips review and apply)', async () => {
    const pattern: FailurePattern = {
      category: 'prompt',
      description: 'repeated failure',
      occurrences: 5,
      taskIds: ['t1', 't2', 't3', 't4', 't5'],
      sampleErrors: ['Error'],
    }
    vi.mocked(analyzeTaskPatterns).mockReturnValue({
      totalExamined: 10,
      patterns: [pattern],
      personaBreakdown: { Pragmatist: { failures: 5, successes: 0, topCategory: 'prompt' } },
    })

    const result = await runEvolutionCycle({ dryRun: true })
    expect(result.record.improvements.length).toBeGreaterThan(0)
    expect(reviewImprovements).not.toHaveBeenCalled()
    expect(applyImprovements).not.toHaveBeenCalled()
  })

  it('records review results in evolution record', async () => {
    const pattern: FailurePattern = {
      category: 'prompt',
      description: 'repeated failure',
      occurrences: 3,
      taskIds: ['t1', 't2', 't3'],
      sampleErrors: ['Error'],
    }
    vi.mocked(analyzeTaskPatterns).mockReturnValue({
      totalExamined: 5,
      patterns: [pattern],
      personaBreakdown: { Pragmatist: { failures: 3, successes: 0, topCategory: 'prompt' } },
    })
    vi.mocked(reviewImprovements).mockImplementation(async (improvements) => {
      return improvements.map(imp => ({
        improvementId: imp.id,
        review: { approved: true, confidence: 0.85, reasoning: 'Looks good' },
      }))
    })

    const result = await runEvolutionCycle()
    expect(result.record.reviewResults).toBeDefined()
    expect(result.record.reviewResults!.length).toBeGreaterThan(0)
    expect(result.record.reviewResults![0]!.review.confidence).toBe(0.85)
  })

  it('handles errors gracefully', async () => {
    vi.mocked(analyzeTaskPatterns).mockImplementation(() => {
      throw new Error('Analysis failed')
    })

    const result = await runEvolutionCycle()
    expect(result.record.status).toBe('failed')
    expect(result.record.error).toBe('Analysis failed')
  })

  it('uses correct trigger from options', async () => {
    const result = await runEvolutionCycle({ trigger: 'scheduled' })
    expect(result.record.trigger).toBe('scheduled')
  })
})
