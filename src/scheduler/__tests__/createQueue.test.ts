/**
 * createQueue / createDelayedQueue 测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createQueue, createDelayedQueue, type Queue } from '../createQueue.js'

describe('createQueue', () => {
  let queue: Queue<string>

  beforeEach(() => {
    queue = createQueue<string>()
  })

  it('should start empty', () => {
    expect(queue.isEmpty()).toBe(true)
    expect(queue.size()).toBe(0)
    expect(queue.dequeue()).toBeNull()
    expect(queue.peek()).toBeNull()
  })

  it('should enqueue and dequeue items', () => {
    queue.enqueue('t1', 'data1')
    queue.enqueue('t2', 'data2')

    expect(queue.size()).toBe(2)
    expect(queue.isEmpty()).toBe(false)

    const item = queue.dequeue()
    expect(item).not.toBeNull()
    expect(item!.id).toBe('t1')
    expect(item!.data).toBe('data1')
    expect(queue.size()).toBe(1)
  })

  it('should dequeue by priority (high > medium > low)', () => {
    queue.enqueue('low-1', 'low', 'low')
    queue.enqueue('high-1', 'high', 'high')
    queue.enqueue('med-1', 'med', 'medium')

    expect(queue.dequeue()!.id).toBe('high-1')
    expect(queue.dequeue()!.id).toBe('med-1')
    expect(queue.dequeue()!.id).toBe('low-1')
    expect(queue.dequeue()).toBeNull()
  })

  it('should dequeue same-priority items by creation time (FIFO)', () => {
    // Need to separate enqueue calls in time
    let time = 1000

    vi.spyOn(Date, 'now').mockImplementation(() => time++)

    queue.enqueue('a', 'first', 'medium')
    queue.enqueue('b', 'second', 'medium')
    queue.enqueue('c', 'third', 'medium')

    expect(queue.dequeue()?.id).toBe('a')
    expect(queue.dequeue()?.id).toBe('b')
    expect(queue.dequeue()?.id).toBe('c')

    vi.restoreAllMocks()
  })

  it('should default to medium priority', () => {
    queue.enqueue('t1', 'data')
    const item = queue.peek()
    expect(item!.priority).toBe('medium')
  })

  it('peek should not remove item', () => {
    queue.enqueue('t1', 'data')
    const peeked = queue.peek()
    expect(peeked!.id).toBe('t1')
    expect(queue.size()).toBe(1) // still there
  })

  it('should get item by ID', () => {
    queue.enqueue('t1', 'data1')
    queue.enqueue('t2', 'data2')

    expect(queue.get('t1')!.data).toBe('data1')
    expect(queue.get('t2')!.data).toBe('data2')
    expect(queue.get('nonexistent')).toBeNull()
  })

  it('should remove item by ID', () => {
    queue.enqueue('t1', 'data1')
    queue.enqueue('t2', 'data2')

    expect(queue.remove('t1')).toBe(true)
    expect(queue.size()).toBe(1)
    expect(queue.get('t1')).toBeNull()

    expect(queue.remove('nonexistent')).toBe(false)
  })

  it('should update priority', () => {
    queue.enqueue('t1', 'data1', 'low')
    queue.enqueue('t2', 'data2', 'medium')

    const result = queue.updatePriority('t1', 'high')
    expect(result.ok).toBe(true)

    // t1 should now be dequeued first (high > medium)
    expect(queue.dequeue()!.id).toBe('t1')
  })

  it('should return error when updating priority of nonexistent item', () => {
    const result = queue.updatePriority('nonexistent', 'high')
    expect(result.ok).toBe(false)
  })

  it('should increment attempts', () => {
    queue.enqueue('t1', 'data1')
    expect(queue.get('t1')!.attempts).toBe(0)

    queue.incrementAttempts('t1')
    expect(queue.get('t1')!.attempts).toBe(1)

    queue.incrementAttempts('t1')
    expect(queue.get('t1')!.attempts).toBe(2)

    // Incrementing nonexistent item should not throw
    queue.incrementAttempts('nonexistent')
  })

  it('should clear all items', () => {
    queue.enqueue('t1', 'data1')
    queue.enqueue('t2', 'data2')

    queue.clear()
    expect(queue.isEmpty()).toBe(true)
    expect(queue.size()).toBe(0)
  })

  it('all() should return sorted items', () => {
    queue.enqueue('low-1', 'low', 'low')
    queue.enqueue('high-1', 'high', 'high')
    queue.enqueue('med-1', 'med', 'medium')

    const all = queue.all()
    expect(all).toHaveLength(3)
    expect(all[0]?.id).toBe('high-1')
    expect(all[1]?.id).toBe('med-1')
    expect(all[2]?.id).toBe('low-1')
  })

  it('filter() should return matching items', () => {
    queue.enqueue('t1', 'data1', 'high')
    queue.enqueue('t2', 'data2', 'low')
    queue.enqueue('t3', 'data3', 'high')

    const highPriority = queue.filter(item => item.priority === 'high')
    expect(highPriority).toHaveLength(2)
    expect(highPriority.map(i => i.id).sort()).toEqual(['t1', 't3'])
  })

  it('should overwrite item with same ID on re-enqueue', () => {
    queue.enqueue('t1', 'original', 'low')
    queue.enqueue('t1', 'updated', 'high')

    expect(queue.size()).toBe(1)
    expect(queue.get('t1')!.data).toBe('updated')
    expect(queue.get('t1')!.priority).toBe('high')
  })
})

describe('createDelayedQueue', () => {
  it('should support basic queue operations', () => {
    const queue = createDelayedQueue<string>()
    queue.enqueue('t1', 'data1')
    expect(queue.size()).toBe(1)
    expect(queue.dequeue()!.id).toBe('t1')
  })

  it('should delay items and process them when ready', () => {
    const queue = createDelayedQueue<string>()

    // Enqueue with 0ms delay (ready immediately)
    queue.enqueueDelayed('d1', 'delayed', 0, 'high')

    // Item not in main queue yet
    expect(queue.size()).toBe(0)

    // Process delayed items
    queue.processDelayed()

    // Now it should be in the queue
    expect(queue.size()).toBe(1)
    const item = queue.dequeue()
    expect(item!.id).toBe('d1')
    expect(item!.data).toBe('delayed')
  })

  it('should not process items whose delay has not elapsed', () => {
    const queue = createDelayedQueue<string>()

    // Enqueue with very long delay
    queue.enqueueDelayed('d1', 'delayed', 999999, 'medium')

    queue.processDelayed()

    // Item should still not be in the queue
    expect(queue.size()).toBe(0)
  })
})
