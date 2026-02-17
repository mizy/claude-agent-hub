import { describe, it, expect, vi, beforeEach } from 'vitest'
import { queueHealthCheck } from '../checks/queueHealth.js'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

vi.mock('../../store/paths.js', () => ({
  QUEUE_FILE: '/tmp/test-data/queue.json',
  TASKS_DIR: '/tmp/test-data/tasks',
}))

import { existsSync, readFileSync } from 'fs'

const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)

describe('queueHealthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should pass when no queue.json exists', async () => {
    mockExistsSync.mockReturnValue(false)
    const result = await queueHealthCheck.run()
    expect(result.status).toBe('pass')
    expect(result.score).toBe(100)
  })

  it('should fail on corrupt JSON', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('not json')
    const result = await queueHealthCheck.run()
    expect(result.status).toBe('fail')
    expect(result.score).toBeLessThan(80)
    expect(result.details).toContainEqual(expect.stringContaining('corrupt'))
  })

  it('should fail if queue has invalid structure', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('{"foo": "bar"}')
    const result = await queueHealthCheck.run()
    expect(result.status).toBe('fail')
    expect(result.details).toContainEqual(expect.stringContaining('invalid structure'))
  })

  it('should pass on empty queue (object format)', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ jobs: [], updatedAt: new Date().toISOString() }))
    const result = await queueHealthCheck.run()
    expect(result.status).toBe('pass')
    expect(result.score).toBe(100)
  })

  it('should pass on empty queue (legacy array format)', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('[]')
    const result = await queueHealthCheck.run()
    expect(result.status).toBe('pass')
    expect(result.score).toBe(100)
  })

  it('should report active jobs', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        jobs: [
          { id: 'job-1', status: 'active' },
          { id: 'job-2', status: 'completed' },
        ],
        updatedAt: new Date().toISOString(),
      }),
    )
    const result = await queueHealthCheck.run()
    expect(result.status).toBe('warning')
    expect(result.score).toBe(95)
    expect(result.fixable).toBe(true)
    expect(result.details).toContainEqual(expect.stringContaining('1 active/waiting'))
    expect(result.details).toContainEqual(expect.stringContaining('1 completed'))
  })

  it('should report total entries', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        jobs: [{ id: 'job-1', status: 'completed' }],
        updatedAt: new Date().toISOString(),
      }),
    )
    const result = await queueHealthCheck.run()
    expect(result.details).toContainEqual(expect.stringContaining('1 total entries'))
  })
})
