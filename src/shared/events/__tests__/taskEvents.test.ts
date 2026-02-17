import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TaskCompletionPayload } from '../taskEvents.js'

// Mock logger before importing taskEvents
vi.mock('../../logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('../../assertError.js', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

describe('TaskEventBus', () => {
  let taskEventBus: (typeof import('../taskEvents.js'))['taskEventBus']
  beforeEach(async () => {
    vi.resetModules()

    const mod = await import('../taskEvents.js')
    taskEventBus = mod.taskEventBus
    taskEventBus.removeAllListeners()
  })

  const dummyPayload: TaskCompletionPayload = {
    task: { id: 'task-1', title: 'test', status: 'completed' } as TaskCompletionPayload['task'],
    success: true,
    durationMs: 1000,
  }

  it('should call listeners on emit', () => {
    const handler = vi.fn()
    taskEventBus.on('task:completed', handler)
    taskEventBus.emit('task:completed', dummyPayload)
    expect(handler).toHaveBeenCalledWith(dummyPayload)
  })

  it('should not throw when sync listener throws', () => {
    taskEventBus.on('task:completed', () => {
      throw new Error('sync boom')
    })
    const handler2 = vi.fn()
    taskEventBus.on('task:completed', handler2)

    // Should not throw
    expect(() => taskEventBus.emit('task:completed', dummyPayload)).not.toThrow()
    // Second listener should still be called
    expect(handler2).toHaveBeenCalledWith(dummyPayload)
  })

  it('should not throw when async listener rejects', async () => {
    taskEventBus.on('task:completed', async () => {
      throw new Error('async boom')
    })
    const handler2 = vi.fn()
    taskEventBus.on('task:completed', handler2)

    expect(() => taskEventBus.emit('task:completed', dummyPayload)).not.toThrow()
    expect(handler2).toHaveBeenCalledWith(dummyPayload)

    // Allow microtask to process the rejection handler
    await new Promise((r) => setTimeout(r, 10))
  })

  it('should return true when listeners exist, false otherwise', () => {
    expect(taskEventBus.emit('task:completed', dummyPayload)).toBe(false)

    taskEventBus.on('task:completed', () => {})
    expect(taskEventBus.emit('task:completed', dummyPayload)).toBe(true)
  })

  it('should call all listeners even when one fails', () => {
    const results: number[] = []
    taskEventBus.on('task:completed', () => results.push(1))
    taskEventBus.on('task:completed', () => {
      throw new Error('fail')
    })
    taskEventBus.on('task:completed', () => results.push(3))

    taskEventBus.emit('task:completed', dummyPayload)
    expect(results).toEqual([1, 3])
  })
})
