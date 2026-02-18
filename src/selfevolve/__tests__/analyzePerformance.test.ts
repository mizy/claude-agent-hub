import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../store/TaskStore.js', () => ({
  getTasksByStatus: vi.fn().mockReturnValue([]),
}))
vi.mock('../../store/ExecutionStatsStore.js', () => ({
  getExecutionStats: vi.fn().mockReturnValue(null),
}))

import { analyzePerformance } from '../analyzePerformance.js'
import { getTasksByStatus } from '../../store/TaskStore.js'
import { getExecutionStats } from '../../store/ExecutionStatsStore.js'
import type { Task } from '../../types/task.js'

type MockStats = NonNullable<ReturnType<typeof getExecutionStats>>

function makeTask(id: string, status: 'completed' | 'failed' = 'completed', createdAt?: string): Task {
  return {
    id,
    title: `Task ${id}`,
    prompt: 'test',
    description: 'test task',
    status,
    priority: 'medium',
    retryCount: 0,
    createdAt: createdAt ?? new Date().toISOString(),
  } as Task
}

function makeStats(overrides?: Record<string, unknown>) {
  return {
    summary: {
      totalDurationMs: 60000,
      totalCostUsd: 0.5,
      nodesTotal: 3,
      nodesFailed: 0,
      avgNodeDurationMs: 20000,
      ...overrides,
    },
    nodes: [
      { nodeName: 'plan', durationMs: 20000, attempts: 1 },
      { nodeName: 'implement', durationMs: 30000, attempts: 1 },
      { nodeName: 'test', durationMs: 10000, attempts: 1 },
    ],
  } as unknown as MockStats
}

describe('analyzePerformance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty analysis when no tasks', () => {
    vi.mocked(getTasksByStatus).mockReturnValue([])
    const result = analyzePerformance()
    expect(result.totalExamined).toBe(0)
    expect(result.patterns).toHaveLength(0)
    expect(result.nodeHotspots).toHaveLength(0)
    expect(result.avgDurationMs).toBe(0)
  })

  it('returns empty analysis when no stats available', () => {
    vi.mocked(getTasksByStatus).mockReturnValue([makeTask('t1'), makeTask('t2')])
    vi.mocked(getExecutionStats).mockReturnValue(null)

    const result = analyzePerformance()
    expect(result.totalExamined).toBe(0)
    expect(result.patterns).toHaveLength(0)
  })

  it('analyzes completed tasks with stats', () => {
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'completed') return [makeTask('t1'), makeTask('t2'), makeTask('t3')]
      return []
    })
    vi.mocked(getExecutionStats).mockReturnValue(makeStats())

    const result = analyzePerformance()
    expect(result.totalExamined).toBe(3)
    expect(result.avgDurationMs).toBe(60000)
    expect(result.avgCostUsd).toBe(0.5)
    expect(result.successRate).toBe(1) // all completed
  })

  it('includes both completed and failed tasks', () => {
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'completed') return [makeTask('t1')]
      if (status === 'failed') return [makeTask('t2', 'failed')]
      return []
    })
    vi.mocked(getExecutionStats).mockReturnValue(makeStats())

    const result = analyzePerformance()
    expect(result.totalExamined).toBe(2)
    expect(result.successRate).toBe(0.5) // 1 completed out of 2
  })

  it('detects slow execution pattern (> 2x average)', () => {
    const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')]
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'completed') return tasks
      return []
    })

    let callCount = 0
    vi.mocked(getExecutionStats).mockImplementation(() => {
      callCount++
      // t1 and t2 are normal, t3 is very slow
      if (callCount === 3) {
        return makeStats({ totalDurationMs: 300000 }) // 5x normal
      }
      return makeStats({ totalDurationMs: 60000 })
    })

    const result = analyzePerformance()
    const slowPattern = result.patterns.find(p => p.category === 'slow_execution')
    expect(slowPattern).toBeDefined()
    expect(slowPattern!.taskIds.length).toBeGreaterThan(0)
  })

  it('detects excessive retries pattern', () => {
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'completed') return [makeTask('t1')]
      return []
    })
    vi.mocked(getExecutionStats).mockReturnValue({
      summary: {
        totalDurationMs: 60000,
        totalCostUsd: 0.5,
        nodesTotal: 3,
        nodesFailed: 0,
        avgNodeDurationMs: 20000,
      },
      nodes: [
        { nodeName: 'plan', durationMs: 20000, attempts: 1 },
        { nodeName: 'implement', durationMs: 30000, attempts: 5 }, // 4 retries
        { nodeName: 'test', durationMs: 10000, attempts: 1 },
      ],
    } as unknown as MockStats)

    const result = analyzePerformance()
    const retryPattern = result.patterns.find(p => p.category === 'excessive_retries')
    expect(retryPattern).toBeDefined()
    expect(retryPattern!.taskIds).toContain('t1')
  })

  it('detects bottleneck node pattern (> 70% of time)', () => {
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'completed') return [makeTask('t1')]
      return []
    })
    vi.mocked(getExecutionStats).mockReturnValue({
      summary: {
        totalDurationMs: 100000,
        totalCostUsd: 0.5,
        nodesTotal: 3,
        nodesFailed: 0,
        avgNodeDurationMs: 33000,
      },
      nodes: [
        { nodeName: 'plan', durationMs: 5000, attempts: 1 },
        { nodeName: 'implement', durationMs: 90000, attempts: 1 }, // 90% of time
        { nodeName: 'test', durationMs: 5000, attempts: 1 },
      ],
    } as unknown as MockStats)

    const result = analyzePerformance()
    const bottleneck = result.patterns.find(p => p.category === 'bottleneck_node')
    expect(bottleneck).toBeDefined()
    expect(bottleneck!.description).toContain('implement')
  })

  it('computes node hotspots sorted by avg duration', () => {
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'completed') return [makeTask('t1'), makeTask('t2')]
      return []
    })
    vi.mocked(getExecutionStats).mockReturnValue(makeStats())

    const result = analyzePerformance()
    expect(result.nodeHotspots.length).toBeGreaterThan(0)
    // Hotspots should be sorted by avgDurationMs descending
    for (let i = 1; i < result.nodeHotspots.length; i++) {
      expect(result.nodeHotspots[i - 1]!.avgDurationMs).toBeGreaterThanOrEqual(
        result.nodeHotspots[i]!.avgDurationMs
      )
    }
  })

  it('filters by since date', () => {
    const old = makeTask('t-old', 'completed', '2024-01-01T00:00:00Z')
    const recent = makeTask('t-new', 'completed', '2025-06-01T00:00:00Z')
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'completed') return [old, recent]
      return []
    })
    vi.mocked(getExecutionStats).mockReturnValue(makeStats())

    const result = analyzePerformance({ since: new Date('2025-01-01') })
    expect(result.totalExamined).toBe(1)
  })

  it('respects limit option', () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask(`t${i}`, 'completed', new Date(2025, 0, i + 1).toISOString())
    )
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'completed') return tasks
      return []
    })
    vi.mocked(getExecutionStats).mockReturnValue(makeStats())

    const result = analyzePerformance({ limit: 3 })
    expect(result.totalExamined).toBe(3)
  })

  it('handles only failed tasks when includeCompleted is false', () => {
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'completed') return [makeTask('t1')]
      if (status === 'failed') return [makeTask('t2', 'failed')]
      return []
    })
    vi.mocked(getExecutionStats).mockReturnValue(makeStats())

    const result = analyzePerformance({ includeCompleted: false })
    expect(result.totalExamined).toBe(1)
    expect(result.successRate).toBe(0) // only failed tasks
  })
})
