/**
 * Self-drive goal management
 *
 * Manages self-drive goals using FileStore.
 * Goals drive the system to periodically health-check and self-evolve.
 */

import { join } from 'path'
import { DATA_DIR } from '../store/paths.js'
import { FileStore } from '../store/GenericFileStore.js'
import { generateShortId } from '../shared/generateId.js'

// ============ Types ============

export type GoalType = 'evolve' | 'cleanup' | 'evolve-conversation' | 'evolve-feature'

export interface DriveGoal {
  id: string
  description: string
  type: GoalType
  priority: 'low' | 'medium' | 'high'
  /** Cron-like interval: e.g. '30m', '1h', '6h', '1d' */
  schedule: string
  enabled: boolean
  createdAt: string
  lastRunAt?: string
  lastResult?: 'success' | 'failure'
  lastError?: string
}

// ============ Store ============

const SELFDRIVE_DIR = join(DATA_DIR, 'selfdrive')

const goalStore = new FileStore<DriveGoal>({
  dir: join(SELFDRIVE_DIR, 'goals'),
  mode: 'file',
  ext: '.json',
})

// ============ CRUD ============

export function addGoal(
  input: Pick<DriveGoal, 'description' | 'type' | 'priority' | 'schedule'> &
    Partial<Pick<DriveGoal, 'enabled'>>
): DriveGoal {
  const goal: DriveGoal = {
    id: `goal-${generateShortId()}`,
    description: input.description,
    type: input.type,
    priority: input.priority,
    schedule: input.schedule,
    enabled: input.enabled ?? true,
    createdAt: new Date().toISOString(),
  }
  goalStore.setSync(goal.id, goal)
  return goal
}

export function updateGoal(id: string, updates: Partial<Omit<DriveGoal, 'id' | 'createdAt'>>): DriveGoal | null {
  const goal = goalStore.getSync(id)
  if (!goal) return null
  const updated = { ...goal, ...updates }
  goalStore.setSync(id, updated)
  return updated
}

export function removeGoal(id: string): boolean {
  return goalStore.deleteSync(id)
}

export function getGoal(id: string): DriveGoal | null {
  return goalStore.getSync(id)
}

export function listGoals(): DriveGoal[] {
  return goalStore.getAllSync()
}

export function listEnabledGoals(): DriveGoal[] {
  return goalStore.getAllSync().filter(g => g.enabled)
}

// ============ Built-in Goals ============

const BUILTIN_GOALS: Omit<DriveGoal, 'id' | 'createdAt'>[] = [
  {
    description: 'Periodic self-evolution cycle',
    type: 'evolve',
    priority: 'medium',
    schedule: '24h',
    enabled: true,
  },
  {
    description: 'Periodic data cleanup (old logs, orphaned files)',
    type: 'cleanup',
    priority: 'low',
    schedule: '6h',
    enabled: false,
  },
  {
    description: 'Periodic conversation experience evolution',
    type: 'evolve-conversation',
    priority: 'medium',
    schedule: '12h',
    enabled: false,
  },
  {
    description: 'Periodic feature gap analysis and enhancement planning',
    type: 'evolve-feature',
    priority: 'low',
    schedule: '1d',
    enabled: false,
  },
]

// Goal types that have been merged into 'evolve' — force-disable if they exist
const DEPRECATED_GOAL_TYPES: GoalType[] = ['evolve-conversation', 'evolve-feature']

/** Ensure built-in goals exist. Idempotent — skips if goals of each type already present.
 *  Also force-disables deprecated goal types that have been merged into 'evolve'. */
export function ensureBuiltinGoals(): void {
  const existing = listGoals()
  const existingTypes = new Set(existing.map(g => g.type))

  for (const builtin of BUILTIN_GOALS) {
    if (!existingTypes.has(builtin.type)) {
      addGoal({
        description: builtin.description,
        type: builtin.type,
        priority: builtin.priority,
        schedule: builtin.schedule,
        enabled: builtin.enabled,
      })
    }
  }

  // Disable deprecated goals that were merged into 'evolve'
  for (const goal of existing) {
    if (DEPRECATED_GOAL_TYPES.includes(goal.type) && goal.enabled) {
      updateGoal(goal.id, { enabled: false })
    }
  }
}

// ============ Goal management helpers ============

export function enableGoal(id: string): DriveGoal | null {
  return updateGoal(id, { enabled: true })
}

export function disableGoal(id: string): DriveGoal | null {
  return updateGoal(id, { enabled: false })
}

export function updateGoalSchedule(id: string, schedule: string): DriveGoal | null {
  return updateGoal(id, { schedule })
}

/** Mark a goal as just executed */
export function markGoalRun(id: string, result: 'success' | 'failure', error?: string): void {
  updateGoal(id, {
    lastRunAt: new Date().toISOString(),
    lastResult: result,
    lastError: error,
  })
}
