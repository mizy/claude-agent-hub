/**
 * @entry Self-drive scheduler (introspection only)
 *
 * Handles introspection goals (daily-reflection, weekly-narrative) and signal detection.
 * Task-type goals (evolve, evolve-feature, cleanup-code, update-docs) are handled
 * by the selfdrive-master workflow instead.
 *
 * Public API:
 * - startScheduler(): start timers for introspection goals + signal detection
 * - stopScheduler(): stop all timers
 * - getSchedulerStatus(): report current scheduler state
 */

import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { ensureBuiltinGoals, listEnabledGoals, getGoal, type DriveGoal } from './goals.js'
import { executeGoal } from './executeGoal.js'
import { runSignalDetection } from './runSignalDetection.js'

const logger = createLogger('selfdrive')

const activeTimers = new Map<string, ReturnType<typeof setInterval>>()
let signalDetectionTimer: ReturnType<typeof setInterval> | null = null

const SIGNAL_DETECTION_INTERVAL_MS = 2 * 60 * 60 * 1000

function parseScheduleMs(schedule: string): number | null {
  const match = schedule.match(/^(\d+)(m|h|d)$/)
  if (!match) return null

  const value = parseInt(match[1]!, 10)
  if (value <= 0) return null

  switch (match[2]) {
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    case 'd':
      return value * 24 * 60 * 60 * 1000
    default:
      return null
  }
}

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 10 * 60 * 1000 // 10 minutes

function isDue(goal: DriveGoal): boolean {
  if (!goal.lastRunAt) return true
  const intervalMs = parseScheduleMs(goal.schedule)
  if (!intervalMs) return false
  const elapsed = Date.now() - new Date(goal.lastRunAt).getTime()

  // Allow early retry for failed goals (up to MAX_RETRIES times)
  if (goal.lastResult === 'failure' && (goal.lastRetryCount ?? 0) < MAX_RETRIES) {
    return elapsed >= RETRY_DELAY_MS
  }

  return elapsed >= intervalMs
}

export function startScheduler(): void {
  stopScheduler()
  ensureBuiltinGoals()

  // Only schedule introspection goals — task-type goals are handled by selfdrive-master workflow
  const introspectionGoals = listEnabledGoals().filter(g => g.type === 'introspection')
  logger.info(`Starting introspection scheduler with ${introspectionGoals.length} goal(s)`)

  for (const goal of introspectionGoals) {
    const intervalMs = parseScheduleMs(goal.schedule)
    if (!intervalMs) {
      logger.warn(`Invalid schedule for goal ${goal.id}: ${goal.schedule}`)
      continue
    }

    if (isDue(goal)) {
      executeGoal(goal).catch(err => logger.error(`Goal ${goal.id} error: ${getErrorMessage(err)}`))
    }

    // Use shorter poll interval so retry (10min) can fire within a long schedule (e.g. 24h)
    const pollInterval = Math.min(intervalMs, RETRY_DELAY_MS)
    const goalId = goal.id
    const timer = setInterval(() => {
      const current = getGoal(goalId)
      if (!current?.enabled) return
      if (!isDue(current)) return
      executeGoal(current).catch(err => logger.error(`Goal ${goalId} error: ${getErrorMessage(err)}`))
    }, pollInterval)

    timer.unref()
    activeTimers.set(goal.id, timer)
  }

  // Signal detection — still needed for reactive evolution triggers
  const initialDelay = setTimeout(() => {
    runSignalDetection(SIGNAL_DETECTION_INTERVAL_MS).catch(err =>
      logger.error(`Initial signal detection error: ${getErrorMessage(err)}`)
    )
  }, 30_000)
  initialDelay.unref()

  signalDetectionTimer = setInterval(() => {
    runSignalDetection(SIGNAL_DETECTION_INTERVAL_MS).catch(err =>
      logger.error(`Signal detection error: ${getErrorMessage(err)}`)
    )
  }, SIGNAL_DETECTION_INTERVAL_MS)
  signalDetectionTimer.unref()

  logger.info('Signal detection scheduled (first run in 30s, then every 2h)')
}

export function stopScheduler(): void {
  for (const [id, timer] of activeTimers) {
    clearInterval(timer)
    logger.debug(`Stopped goal timer: ${id}`)
  }
  activeTimers.clear()

  if (signalDetectionTimer) {
    clearInterval(signalDetectionTimer)
    signalDetectionTimer = null
    logger.debug('Stopped signal detection timer')
  }
}

export function getSchedulerStatus(): {
  running: boolean
  activeGoals: number
  goalIds: string[]
} {
  return {
    running: activeTimers.size > 0,
    activeGoals: activeTimers.size,
    goalIds: [...activeTimers.keys()],
  }
}
