/**
 * createWorker 测试
 */

import { describe, it, expect, vi } from 'vitest'
import { createWorker, type WorkerConfig, type WorkerContext } from '../createWorker.js'

function makeConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    name: 'test-worker',
    concurrency: 1,
    timeout: 5000,
    maxRetries: 0,
    retryDelay: 50,
    ...overrides,
  }
}

describe('createWorker', () => {
  it('should start with idle status', () => {
    const worker = createWorker(makeConfig(), async () => 'ok')
    expect(worker.status()).toBe('idle')
    expect(worker.runningCount()).toBe(0)
  })

  it('should transition to running on start()', () => {
    const worker = createWorker(makeConfig(), async () => 'ok')
    worker.start()
    expect(worker.status()).toBe('running')
  })

  it('start() should be idempotent', () => {
    const worker = createWorker(makeConfig(), async () => 'ok')
    worker.start()
    worker.start()
    expect(worker.status()).toBe('running')
  })

  it('should execute a task and return Result.ok', async () => {
    const handler = vi.fn(async (ctx: WorkerContext<string>) => {
      return `processed: ${ctx.task}`
    })

    const worker = createWorker(makeConfig(), handler)
    worker.start()

    const result = await worker.execute('hello')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('processed: hello')
    }
  })

  it('should return Result.err on handler failure', async () => {
    const worker = createWorker(makeConfig(), async () => {
      throw new Error('task failed')
    })
    worker.start()

    const result = await worker.execute('data')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toBe('task failed')
    }
  })

  it('should return error when executing on stopped worker', async () => {
    const worker = createWorker(makeConfig(), async () => 'ok')
    worker.start()
    await worker.stop()

    const result = await worker.execute('data')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/stop/i)
    }
  })

  it('should retry on failure when maxRetries > 0', async () => {
    let attempts = 0
    const worker = createWorker(
      makeConfig({ maxRetries: 2, retryDelay: 10 }),
      async () => {
        attempts++
        if (attempts < 3) throw new Error('not yet')
        return 'success'
      }
    )
    worker.start()

    const result = await worker.execute('data')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('success')
    }
    expect(attempts).toBe(3) // 1 initial + 2 retries
  })

  it('should fail after exhausting retries', async () => {
    const worker = createWorker(
      makeConfig({ maxRetries: 1, retryDelay: 10 }),
      async () => {
        throw new Error('always fails')
      }
    )
    worker.start()

    const result = await worker.execute('data')
    expect(result.ok).toBe(false)
  })

  it('should pass correct attempt number to handler', async () => {
    const attempts: number[] = []
    const worker = createWorker(
      makeConfig({ maxRetries: 2, retryDelay: 10 }),
      async (ctx) => {
        attempts.push(ctx.attempt)
        if (ctx.attempt < 3) throw new Error('retry')
        return 'done'
      }
    )
    worker.start()

    await worker.execute('data')
    expect(attempts).toEqual([1, 2, 3])
  })

  it('should provide AbortSignal in context', async () => {
    let signal: AbortSignal | null = null
    const worker = createWorker(makeConfig(), async (ctx) => {
      signal = ctx.signal
      return 'ok'
    })
    worker.start()

    await worker.execute('data')
    expect(signal).not.toBeNull()
    expect(signal!.aborted).toBe(false)
  })

  it('pause/resume should work', async () => {
    const worker = createWorker(makeConfig(), async () => 'ok')
    worker.start()
    expect(worker.status()).toBe('running')

    worker.pause()
    expect(worker.status()).toBe('paused')

    worker.resume()
    expect(worker.status()).toBe('running')
  })

  it('pause on non-running should be no-op', () => {
    const worker = createWorker(makeConfig(), async () => 'ok')
    worker.pause()
    expect(worker.status()).toBe('idle')
  })

  it('resume on non-paused should be no-op', () => {
    const worker = createWorker(makeConfig(), async () => 'ok')
    worker.start()
    worker.resume() // already running, not paused
    expect(worker.status()).toBe('running')
  })

  it('stop() should abort running tasks', async () => {
    let aborted = false
    const worker = createWorker(makeConfig({ timeout: 10000 }), async (ctx) => {
      // Long-running task
      await new Promise((resolve, reject) => {
        ctx.signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
        setTimeout(resolve, 5000)
      })
      return 'done'
    })
    worker.start()

    // Start a task but don't await it
    const taskPromise = worker.execute('data')

    // Give it a moment to start
    await new Promise(r => setTimeout(r, 50))

    // Stop the worker
    await worker.stop()

    expect(worker.status()).toBe('stopped')
    expect(aborted).toBe(true)

    const result = await taskPromise
    expect(result.ok).toBe(false)
  })

  it('should track running count', async () => {
    let resolve1: () => void
    const promise1 = new Promise<void>(r => { resolve1 = r })

    const worker = createWorker(
      makeConfig({ concurrency: 2 }),
      async () => {
        await promise1
        return 'done'
      }
    )
    worker.start()

    const task1 = worker.execute('t1')

    // Wait for task to start
    await new Promise(r => setTimeout(r, 20))
    expect(worker.runningCount()).toBe(1)

    resolve1!()
    await task1
    expect(worker.runningCount()).toBe(0)
  })
})
