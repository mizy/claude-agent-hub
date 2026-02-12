/**
 * EventBus 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import the factory, not the singleton, to avoid cross-test contamination
// We test the exported helpers (emitEvent, onEvent) and the eventBus directly

describe('EventBus', () => {
  // Create fresh bus for each test by importing the module-level helpers
  // and clearing between tests
  let eventBus: (typeof import('../eventBus.js'))['eventBus']
  let emitEvent: (typeof import('../eventBus.js'))['emitEvent']
  let onEvent: (typeof import('../eventBus.js'))['onEvent']

  beforeEach(async () => {
    const mod = await import('../eventBus.js')
    eventBus = mod.eventBus
    emitEvent = mod.emitEvent
    onEvent = mod.onEvent
    eventBus.clear() // clear all handlers between tests
  })

  it('on() should register handler and receive events', async () => {
    const handler = vi.fn()
    eventBus.on('test-event', handler)

    await eventBus.emit('test-event', { data: 42 })

    expect(handler).toHaveBeenCalledWith({ data: 42 })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('on() should return unsubscribe function', async () => {
    const handler = vi.fn()
    const unsubscribe = eventBus.on('test-event', handler)

    await eventBus.emit('test-event', 'first')
    expect(handler).toHaveBeenCalledTimes(1)

    unsubscribe()

    await eventBus.emit('test-event', 'second')
    expect(handler).toHaveBeenCalledTimes(1) // not called again
  })

  it('off() should remove handler', async () => {
    const handler = vi.fn()
    eventBus.on('test-event', handler)
    eventBus.off('test-event', handler)

    await eventBus.emit('test-event', 'data')
    expect(handler).not.toHaveBeenCalled()
  })

  it('emit() should handle no registered handlers', async () => {
    // Should not throw
    await eventBus.emit('no-listeners', { data: 1 })
  })

  it('emit() should call multiple handlers', async () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    eventBus.on('multi', handler1)
    eventBus.on('multi', handler2)

    await eventBus.emit('multi', 'payload')

    expect(handler1).toHaveBeenCalledWith('payload')
    expect(handler2).toHaveBeenCalledWith('payload')
  })

  it('emit() should handle sync handler errors gracefully', async () => {
    const badHandler = vi.fn(() => {
      throw new Error('handler error')
    })
    const goodHandler = vi.fn()

    eventBus.on('test', badHandler)
    eventBus.on('test', goodHandler)

    // Should not throw despite handler error
    await eventBus.emit('test', 'data')

    expect(badHandler).toHaveBeenCalled()
    expect(goodHandler).toHaveBeenCalled()
  })

  it('emit() should handle async handler rejections gracefully', async () => {
    const badAsyncHandler = vi.fn(async () => {
      throw new Error('async handler error')
    })
    const goodHandler = vi.fn()

    eventBus.on('test', badAsyncHandler)
    eventBus.on('test', goodHandler)

    // Should not throw despite async handler rejection
    await eventBus.emit('test', 'data')

    expect(badAsyncHandler).toHaveBeenCalled()
    expect(goodHandler).toHaveBeenCalled()
  })

  it('once() should fire handler only once', async () => {
    const handler = vi.fn()
    eventBus.once('once-event', handler)

    await eventBus.emit('once-event', 'first')
    await eventBus.emit('once-event', 'second')

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('first')
  })

  it('once() should return unsubscribe function', async () => {
    const handler = vi.fn()
    const unsubscribe = eventBus.once('once-event', handler)

    unsubscribe()

    await eventBus.emit('once-event', 'data')
    expect(handler).not.toHaveBeenCalled()
  })

  it('clear(event) should clear handlers for specific event', async () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    eventBus.on('event-a', handler1)
    eventBus.on('event-b', handler2)

    eventBus.clear('event-a')

    await eventBus.emit('event-a', 'data')
    await eventBus.emit('event-b', 'data')

    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).toHaveBeenCalled()
  })

  it('clear() should clear all handlers', async () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    eventBus.on('event-a', handler1)
    eventBus.on('event-b', handler2)

    eventBus.clear()

    await eventBus.emit('event-a', 'data')
    await eventBus.emit('event-b', 'data')

    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).not.toHaveBeenCalled()
  })

  it('emit() should support async handlers', async () => {
    const order: number[] = []

    eventBus.on('async', async () => {
      await new Promise(r => setTimeout(r, 10))
      order.push(1)
    })
    eventBus.on('async', async () => {
      order.push(2)
    })

    await eventBus.emit('async', null)

    // Both should have completed
    expect(order).toContain(1)
    expect(order).toContain(2)
  })

  // Test typed event helpers
  describe('typed event helpers', () => {
    it('onEvent / emitEvent should work with SchedulerEvents types', async () => {
      const handler = vi.fn()
      const unsubscribe = onEvent('task:created', handler)

      await emitEvent('task:created', { taskId: 'test-123' })

      expect(handler).toHaveBeenCalledWith({ taskId: 'test-123' })

      unsubscribe()
    })

    it('emitEvent should support all scheduler event types', async () => {
      const handlers = {
        started: vi.fn(),
        completed: vi.fn(),
        failed: vi.fn(),
        schedulerStarted: vi.fn(),
      }

      onEvent('task:started', handlers.started)
      onEvent('task:completed', handlers.completed)
      onEvent('task:failed', handlers.failed)
      onEvent('scheduler:started', handlers.schedulerStarted)

      await emitEvent('task:started', { taskId: 't1' })
      await emitEvent('task:completed', { taskId: 't2' })
      await emitEvent('task:failed', { taskId: 't3', error: 'oops' })
      await emitEvent('scheduler:started', { pid: 1234 })

      expect(handlers.started).toHaveBeenCalledWith({ taskId: 't1' })
      expect(handlers.completed).toHaveBeenCalledWith({ taskId: 't2' })
      expect(handlers.failed).toHaveBeenCalledWith({ taskId: 't3', error: 'oops' })
      expect(handlers.schedulerStarted).toHaveBeenCalledWith({ pid: 1234 })
    })
  })
})
