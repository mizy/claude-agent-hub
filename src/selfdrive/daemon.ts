/**
 * Self-drive daemon integration
 *
 * Integrates self-drive into the existing daemon process.
 * Controlled via configuration — not a separate process.
 * State persisted to .cah-data/selfdrive/state.json
 */

import { join } from 'path'
import { DATA_DIR } from '../store/paths.js'
import { FileStore } from '../store/GenericFileStore.js'
import { createLogger } from '../shared/logger.js'
import { ensureBuiltinGoals } from './goals.js'
import { startScheduler, stopScheduler, getSchedulerStatus } from './scheduler.js'

const logger = createLogger('selfdrive')

// ============ State ============

interface SelfDriveState {
  enabled: boolean
  permanentlyDisabled?: boolean
  startedAt?: string
  stoppedAt?: string
}

const SELFDRIVE_DIR = join(DATA_DIR, 'selfdrive')

const stateStore = new FileStore<SelfDriveState>({
  dir: SELFDRIVE_DIR,
  mode: 'file',
  ext: '.json',
})

const STATE_KEY = 'state'

function getState(): SelfDriveState {
  return stateStore.getSync(STATE_KEY) ?? { enabled: false }
}

function saveState(state: SelfDriveState): void {
  stateStore.setSync(STATE_KEY, state)
}

// ============ Control ============

/** Start self-drive mode. Initializes built-in goals and starts scheduler. */
export function startSelfDrive(): void {
  const state = getState()
  if (state.enabled) {
    logger.debug('Self-drive already enabled')
    return
  }

  ensureBuiltinGoals()
  startScheduler()

  saveState({
    enabled: true,
    startedAt: new Date().toISOString(),
  })

  logger.info('Self-drive started')
}

/** Stop self-drive mode (temporary — daemon restart will resume). */
export function stopSelfDrive(): void {
  const state = getState()
  if (!state.enabled) {
    logger.debug('Self-drive already disabled')
    return
  }

  stopScheduler()

  saveState({
    ...state,
    enabled: false,
    stoppedAt: new Date().toISOString(),
  })

  logger.info('Self-drive stopped')
}

/** Permanently disable self-drive. Daemon restart will NOT auto-resume. */
export function disableSelfDrive(): void {
  const state = getState()
  if (state.enabled) {
    stopScheduler()
  }
  saveState({
    ...state,
    enabled: false,
    permanentlyDisabled: true,
    stoppedAt: new Date().toISOString(),
  })
  logger.info('Self-drive permanently disabled')
}

/** Remove permanent disable flag. Self-drive will auto-start on next daemon restart. */
export function enableSelfDrive(): void {
  const state = getState()
  saveState({
    ...state,
    permanentlyDisabled: false,
  })
  logger.info('Self-drive enabled (will auto-start on next daemon restart)')
}

/** Check if self-drive is permanently disabled */
export function isSelfDrivePermanentlyDisabled(): boolean {
  return getState().permanentlyDisabled === true
}

/** Get self-drive status */
export function getSelfDriveStatus(): {
  enabled: boolean
  startedAt?: string
  stoppedAt?: string
  scheduler: ReturnType<typeof getSchedulerStatus>
} {
  const state = getState()
  return {
    enabled: state.enabled,
    startedAt: state.startedAt,
    stoppedAt: state.stoppedAt,
    scheduler: getSchedulerStatus(),
  }
}

/**
 * Resume self-drive on daemon start.
 * Auto-starts unless the user has explicitly and permanently disabled it.
 * A temporary stop (via stopSelfDrive) is NOT permanent — daemon restart resumes it.
 */
export function resumeSelfDriveIfEnabled(): void {
  const state = getState()
  if (state.permanentlyDisabled) {
    logger.info('Self-drive permanently disabled, skipping auto-start')
    return
  }
  logger.info('Auto-starting self-drive on daemon start')
  ensureBuiltinGoals()
  startScheduler()
  saveState({
    ...state,
    enabled: true,
    startedAt: new Date().toISOString(),
  })
}
