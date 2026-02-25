import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock goal dependencies
vi.mock('../goals.js', () => ({
  listEnabledGoals: vi.fn().mockReturnValue([]),
  markGoalRun: vi.fn(),
  ensureBuiltinGoals: vi.fn(),
}))

// Mock heavy dependencies that scheduler calls
vi.mock('../../selfcheck/index.js', () => ({
  runSelfcheck: vi.fn().mockResolvedValue({
    hasFailed: false,
    totalScore: 100,
    checks: [],
  }),
  runFixes: vi.fn().mockResolvedValue([]),
  generateRepairTask: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../selfevolve/index.js', () => ({
  runEvolutionCycle: vi.fn().mockResolvedValue({
    evolutionId: 'evo-test',
    record: { status: 'completed', patterns: [], improvements: [] },
  }),
}))

import { startScheduler, stopScheduler, getSchedulerStatus } from '../scheduler.js'
import { listEnabledGoals } from '../goals.js'
import type { DriveGoal } from '../goals.js'

function makeGoal(type: string, schedule: string, overrides?: Partial<DriveGoal>): DriveGoal {
  return {
    id: `goal-${type}`,
    description: `Test ${type} goal`,
    type: type as DriveGoal['type'],
    priority: 'medium',
    schedule,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    stopScheduler()
  })

  afterEach(() => {
    stopScheduler()
    vi.useRealTimers()
  })

  it('starts with no goals → status shows not running', () => {
    vi.mocked(listEnabledGoals).mockReturnValue([])
    startScheduler()
    const status = getSchedulerStatus()
    expect(status.running).toBe(false)
    expect(status.activeGoals).toBe(0)
  })

  it('schedules enabled goals', () => {
    vi.mocked(listEnabledGoals).mockReturnValue([
      makeGoal('health-check', '30m'),
      makeGoal('evolve', '1h'),
    ])
    startScheduler()
    const status = getSchedulerStatus()
    expect(status.running).toBe(true)
    expect(status.activeGoals).toBe(2)
    expect(status.goalIds).toContain('goal-health-check')
    expect(status.goalIds).toContain('goal-evolve')
  })

  it('stops all timers on stopScheduler', () => {
    vi.mocked(listEnabledGoals).mockReturnValue([makeGoal('health-check', '30m')])
    startScheduler()
    expect(getSchedulerStatus().running).toBe(true)
    stopScheduler()
    expect(getSchedulerStatus().running).toBe(false)
    expect(getSchedulerStatus().activeGoals).toBe(0)
  })

  it('skips goals with invalid schedule', () => {
    vi.mocked(listEnabledGoals).mockReturnValue([
      makeGoal('health-check', 'invalid'),
    ])
    startScheduler()
    expect(getSchedulerStatus().activeGoals).toBe(0)
  })

  it('restarts cleanly (stop existing + start new)', () => {
    vi.mocked(listEnabledGoals).mockReturnValue([makeGoal('health-check', '30m')])
    startScheduler()
    expect(getSchedulerStatus().activeGoals).toBe(1)

    // Start again — should clear old timers first
    vi.mocked(listEnabledGoals).mockReturnValue([
      makeGoal('health-check', '30m'),
      makeGoal('evolve', '1h'),
    ])
    startScheduler()
    expect(getSchedulerStatus().activeGoals).toBe(2)
  })
})
