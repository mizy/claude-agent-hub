import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs, child_process, and pidLock before importing
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
}))

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('../../scheduler/pidLock.js', () => ({
  getPidLock: vi.fn(),
  isProcessRunning: vi.fn(),
  isServiceRunning: vi.fn(),
}))

vi.mock('../../scheduler/stopDaemon.js', () => ({
  stopDaemon: vi.fn().mockResolvedValue(undefined),
}))

import { existsSync, statSync } from 'fs'
import { execSync } from 'child_process'
import { getPidLock, isProcessRunning } from '../../scheduler/pidLock.js'

describe('versionConsistencyCheck', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  async function loadCheck() {
    const { versionConsistencyCheck } = await import('../checks/versionConsistency.js')
    return versionConsistencyCheck
  }

  it('returns pass when no dist found', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const check = await loadCheck()
    const result = await check.run()
    expect(result.status).toBe('warning')
    expect(result.score).toBe(80)
    expect(result.fixable).toBe(false)
  })

  it('returns pass when daemon not running', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(statSync).mockReturnValue({ mtime: new Date() } as ReturnType<typeof statSync>)
    vi.mocked(getPidLock).mockReturnValue(null)

    const check = await loadCheck()
    const result = await check.run()
    expect(result.status).toBe('pass')
    expect(result.score).toBe(100)
  })

  it('detects stale daemon and marks fixable with diagnosis', async () => {
    const buildTime = new Date('2026-02-16T10:00:00Z')
    const startTime = new Date('2026-02-16T09:00:00Z') // started before build

    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(statSync).mockReturnValue({ mtime: buildTime } as ReturnType<typeof statSync>)
    vi.mocked(getPidLock).mockReturnValue({ pid: 12345, startedAt: startTime.toISOString(), cwd: '/test', command: 'node' })
    vi.mocked(isProcessRunning).mockReturnValue(true)
    vi.mocked(execSync).mockReturnValue(startTime.toString())

    const check = await loadCheck()
    const result = await check.run()

    expect(result.status).toBe('fail')
    expect(result.score).toBe(70)
    expect(result.fixable).toBe(true)
    expect(result.fix).toBeDefined()
    expect(result.diagnosis).toBeDefined()
    expect(result.diagnosis?.category).toBe('stale_code')
  })

  it('returns pass when daemon started after build', async () => {
    const buildTime = new Date('2026-02-16T09:00:00Z')
    const startTime = new Date('2026-02-16T10:00:00Z') // started after build

    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(statSync).mockReturnValue({ mtime: buildTime } as ReturnType<typeof statSync>)
    vi.mocked(getPidLock).mockReturnValue({ pid: 12345, startedAt: startTime.toISOString(), cwd: '/test', command: 'node' })
    vi.mocked(isProcessRunning).mockReturnValue(true)
    vi.mocked(execSync).mockReturnValue(startTime.toString())

    const check = await loadCheck()
    const result = await check.run()

    expect(result.status).toBe('pass')
    expect(result.score).toBe(100)
    expect(result.fixable).toBe(false)
    expect(result.diagnosis).toBeUndefined()
  })
})
