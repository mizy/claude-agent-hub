import { describe, it, expect, beforeEach } from 'vitest'
import { rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  addGoal,
  updateGoal,
  removeGoal,
  getGoal,
  listGoals,
  listEnabledGoals,
  ensureBuiltinGoals,
  markGoalRun,
} from '../goals.js'

// DATA_DIR is set to tmpdir by vitest.config.ts
const DATA_DIR = process.env.CAH_DATA_DIR || join(tmpdir(), 'cah-test-data')
const GOALS_DIR = join(DATA_DIR, 'selfdrive', 'goals')

describe('goals', () => {
  beforeEach(() => {
    // Clean goals dir before each test
    if (existsSync(GOALS_DIR)) {
      rmSync(GOALS_DIR, { recursive: true, force: true })
    }
  })

  describe('addGoal', () => {
    it('creates a goal with generated ID', () => {
      const goal = addGoal({
        description: 'Test goal',
        type: 'evolve',
        priority: 'high',
        schedule: '30m',
      })
      expect(goal.id).toMatch(/^goal-/)
      expect(goal.description).toBe('Test goal')
      expect(goal.type).toBe('evolve')
      expect(goal.enabled).toBe(true)
      expect(goal.createdAt).toBeTruthy()
    })

    it('respects enabled=false', () => {
      const goal = addGoal({
        description: 'Disabled',
        type: 'cleanup',
        priority: 'low',
        schedule: '6h',
        enabled: false,
      })
      expect(goal.enabled).toBe(false)
    })
  })

  describe('getGoal / listGoals', () => {
    it('retrieves a goal by ID', () => {
      const goal = addGoal({ description: 'Find me', type: 'evolve', priority: 'medium', schedule: '1h' })
      const found = getGoal(goal.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(goal.id)
    })

    it('returns null for non-existent goal', () => {
      expect(getGoal('goal-nonexistent')).toBeNull()
    })

    it('lists all goals', () => {
      addGoal({ description: 'A', type: 'evolve', priority: 'high', schedule: '30m' })
      addGoal({ description: 'B', type: 'evolve', priority: 'medium', schedule: '1h' })
      const all = listGoals()
      expect(all).toHaveLength(2)
    })
  })

  describe('updateGoal', () => {
    it('updates goal fields', () => {
      const goal = addGoal({ description: 'Original', type: 'evolve', priority: 'high', schedule: '30m' })
      const updated = updateGoal(goal.id, { priority: 'low', enabled: false })
      expect(updated).not.toBeNull()
      expect(updated!.priority).toBe('low')
      expect(updated!.enabled).toBe(false)
      expect(updated!.description).toBe('Original')
    })

    it('returns null for non-existent goal', () => {
      expect(updateGoal('goal-nope', { priority: 'low' })).toBeNull()
    })
  })

  describe('removeGoal', () => {
    it('removes an existing goal', () => {
      const goal = addGoal({ description: 'Delete me', type: 'cleanup', priority: 'low', schedule: '6h' })
      const removed = removeGoal(goal.id)
      expect(removed).toBe(true)
      expect(getGoal(goal.id)).toBeNull()
    })
  })

  describe('listEnabledGoals', () => {
    it('only returns enabled goals', () => {
      addGoal({ description: 'Enabled', type: 'evolve', priority: 'high', schedule: '30m', enabled: true })
      addGoal({ description: 'Disabled', type: 'cleanup', priority: 'low', schedule: '6h', enabled: false })
      const enabled = listEnabledGoals()
      expect(enabled).toHaveLength(1)
      expect(enabled[0]!.description).toBe('Enabled')
    })
  })

  describe('ensureBuiltinGoals', () => {
    it('creates built-in goals on first call', () => {
      ensureBuiltinGoals()
      const goals = listGoals()
      expect(goals.length).toBeGreaterThanOrEqual(3)
      const types = goals.map(g => g.type)
      expect(types).toContain('evolve')
      expect(types).toContain('cleanup-code')
      expect(types).toContain('update-docs')
    })

    it('is idempotent — does not duplicate on second call', () => {
      ensureBuiltinGoals()
      const countAfterFirst = listGoals().length
      ensureBuiltinGoals()
      expect(listGoals()).toHaveLength(countAfterFirst)
    })
  })

  describe('markGoalRun', () => {
    it('updates lastRunAt and lastResult', () => {
      const goal = addGoal({ description: 'Run me', type: 'evolve', priority: 'high', schedule: '30m' })
      markGoalRun(goal.id, 'success')
      const updated = getGoal(goal.id)
      expect(updated!.lastRunAt).toBeTruthy()
      expect(updated!.lastResult).toBe('success')
    })

    it('records error on failure', () => {
      const goal = addGoal({ description: 'Fail me', type: 'evolve', priority: 'medium', schedule: '1h' })
      markGoalRun(goal.id, 'failure', 'Something broke')
      const updated = getGoal(goal.id)
      expect(updated!.lastResult).toBe('failure')
      expect(updated!.lastError).toBe('Something broke')
    })
  })
})
