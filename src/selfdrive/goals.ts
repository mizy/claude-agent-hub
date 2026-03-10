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

export type GoalType = 'evolve' | 'evolve-feature' | 'cleanup-code' | 'update-docs' | 'introspection'

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
  /** Retry count for consecutive failures (reset on success) */
  lastRetryCount?: number
  /** Handler function name for introspection goals (executed in-process, no task created) */
  handler?: string
  /** Stable identifier for built-in goal dedup (survives description changes) */
  slug?: string
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
    Partial<Pick<DriveGoal, 'enabled' | 'handler' | 'slug'>>
): DriveGoal {
  const goal: DriveGoal = {
    id: `goal-${generateShortId()}`,
    description: input.description,
    type: input.type,
    priority: input.priority,
    schedule: input.schedule,
    enabled: input.enabled ?? true,
    createdAt: new Date().toISOString(),
    ...(input.handler ? { handler: input.handler } : {}),
    ...(input.slug ? { slug: input.slug } : {}),
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

const BUILTIN_GOALS: (Omit<DriveGoal, 'id' | 'createdAt'> & { slug: string })[] = [
  {
    slug: 'evolve',
    description: 'Periodic self-evolution cycle',
    type: 'evolve',
    priority: 'medium',
    schedule: '24h',
    enabled: true,
  },
  {
    slug: 'evolve-feature',
    description: 'Discover external inspiration for new features',
    type: 'evolve-feature',
    priority: 'low',
    schedule: '3d',
    enabled: true,
  },
  {
    slug: 'cleanup-code',
    description: 'Periodic code and doc cleanup (dead code, unused exports)',
    type: 'cleanup-code',
    priority: 'low',
    schedule: '3d',
    enabled: true,
  },
  {
    slug: 'update-docs',
    description: 'Periodic project documentation update',
    type: 'update-docs',
    priority: 'low',
    schedule: '2d',
    enabled: true,
  },
  {
    slug: 'daily-reflection',
    description: 'Daily self-reflection and state awareness',
    type: 'introspection',
    priority: 'medium',
    schedule: '24h',
    enabled: true,
    handler: 'runDailyReflection',
  },
  {
    slug: 'weekly-narrative',
    description: 'Weekly self-narrative synthesis',
    type: 'introspection',
    priority: 'low',
    schedule: '7d',
    enabled: true,
    handler: 'runWeeklyNarrative',
  },
]

/** Ensure built-in goals exist. Idempotent — dedup by slug (stable across description changes). */
export function ensureBuiltinGoals(): void {
  const existing = listGoals()
  const existingSlugs = new Set(existing.map(g => g.slug).filter(Boolean))
  // Fallback: also check description for old goals without slug
  const existingDescriptions = new Set(existing.map(g => g.description))

  for (const builtin of BUILTIN_GOALS) {
    if (existingSlugs.has(builtin.slug) || existingDescriptions.has(builtin.description)) continue
    addGoal({
      description: builtin.description,
      type: builtin.type,
      priority: builtin.priority,
      schedule: builtin.schedule,
      enabled: builtin.enabled,
      handler: builtin.handler,
      slug: builtin.slug,
    })
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
  const goal = getGoal(id)
  const retryCount = result === 'failure' ? (goal?.lastRetryCount ?? 0) + 1 : 0
  updateGoal(id, {
    lastRunAt: new Date().toISOString(),
    lastResult: result,
    lastError: error,
    lastRetryCount: retryCount,
  })
}
