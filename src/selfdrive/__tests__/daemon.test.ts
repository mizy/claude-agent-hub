import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock scheduler to avoid actual timer side effects
vi.mock('../scheduler.js', () => ({
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
  getSchedulerStatus: vi.fn().mockReturnValue({
    running: false,
    activeGoals: 0,
    goalIds: [],
  }),
}))

vi.mock('../goals.js', () => ({
  ensureBuiltinGoals: vi.fn(),
}))

import {
  startSelfDrive,
  stopSelfDrive,
  getSelfDriveStatus,
  resumeSelfDriveIfEnabled,
} from '../daemon.js'
import { startScheduler, stopScheduler, getSchedulerStatus } from '../scheduler.js'
import { ensureBuiltinGoals } from '../goals.js'

const DATA_DIR = process.env.CAH_DATA_DIR || join(tmpdir(), 'cah-test-data')
const SELFDRIVE_DIR = join(DATA_DIR, 'selfdrive')

describe('daemon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clean state between tests
    if (existsSync(SELFDRIVE_DIR)) {
      rmSync(SELFDRIVE_DIR, { recursive: true, force: true })
    }
  })

  it('starts self-drive: initializes goals and starts scheduler', () => {
    startSelfDrive()
    expect(ensureBuiltinGoals).toHaveBeenCalledOnce()
    expect(startScheduler).toHaveBeenCalledOnce()

    const status = getSelfDriveStatus()
    expect(status.enabled).toBe(true)
    expect(status.startedAt).toBeTruthy()
  })

  it('start is idempotent when already enabled', () => {
    startSelfDrive()
    startSelfDrive() // second call
    expect(ensureBuiltinGoals).toHaveBeenCalledOnce()
    expect(startScheduler).toHaveBeenCalledOnce()
  })

  it('stops self-drive: stops scheduler, updates state', () => {
    startSelfDrive()
    stopSelfDrive()
    expect(stopScheduler).toHaveBeenCalledOnce()

    const status = getSelfDriveStatus()
    expect(status.enabled).toBe(false)
    expect(status.stoppedAt).toBeTruthy()
  })

  it('stop is no-op when already disabled', () => {
    stopSelfDrive()
    expect(stopScheduler).not.toHaveBeenCalled()
  })

  it('getSelfDriveStatus shows scheduler info', () => {
    vi.mocked(getSchedulerStatus).mockReturnValue({
      running: true,
      activeGoals: 2,
      goalIds: ['g1', 'g2'],
    })
    startSelfDrive()
    const status = getSelfDriveStatus()
    expect(status.scheduler.running).toBe(true)
    expect(status.scheduler.activeGoals).toBe(2)
  })

  it('resumeSelfDriveIfEnabled resumes when state.enabled is true', () => {
    // Start and then simulate daemon restart by clearing mocks
    startSelfDrive()
    vi.clearAllMocks()

    // Now resume — should re-start scheduler since state says enabled
    resumeSelfDriveIfEnabled()
    expect(ensureBuiltinGoals).toHaveBeenCalledOnce()
    expect(startScheduler).toHaveBeenCalledOnce()
  })

  it('resumeSelfDriveIfEnabled does nothing when disabled', () => {
    // Never started → state.enabled = false
    resumeSelfDriveIfEnabled()
    expect(startScheduler).not.toHaveBeenCalled()
  })
})
