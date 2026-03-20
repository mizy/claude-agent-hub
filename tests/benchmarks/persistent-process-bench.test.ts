/**
 * Performance benchmark: PersistentProcess (persistent) vs one-shot mode
 *
 * Uses mock processes to measure architectural overhead (stdin injection latency,
 * event parsing, state transitions) without consuming API credits.
 *
 * Set BENCH_REAL_CLI=1 to run real Claude CLI benchmarks (costs API credits).
 *
 * @entry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { Writable } from 'stream'

// ============ Mock setup ============

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

vi.mock('../../src/shared/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { execa } from 'execa'
import { PersistentProcess, type PersistentProcessEvent } from '../../src/backend/PersistentProcess.js'

const mockedExeca = vi.mocked(execa)

// ============ Helpers ============

interface MockProc extends EventEmitter {
  stdout: EventEmitter
  stdin: Writable & { written: string[] }
  exitCode: number | null
  kill: ReturnType<typeof vi.fn>
  then?: () => void
  catch?: () => void
}

function createMockProc(): MockProc {
  const proc = new EventEmitter() as MockProc
  proc.stdout = new EventEmitter()
  const written: string[] = []
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      written.push(chunk.toString())
      cb()
    },
  }) as MockProc['stdin']
  stdin.written = written
  const origEnd = stdin.end.bind(stdin)
  stdin.end = (...args: unknown[]) => origEnd(...(args as Parameters<typeof origEnd>))
  proc.stdin = stdin
  proc.exitCode = null
  proc.kill = vi.fn()
  proc.catch = vi.fn()
  return proc
}

function emitLine(proc: MockProc, obj: unknown) {
  proc.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'))
}

/** Simulate a complete one-shot invocation cycle (spawn → parse → result) */
async function simulateOneShotCycle(coldStartMs: number): Promise<number> {
  const start = performance.now()
  // Simulate spawn overhead
  await sleep(coldStartMs)
  // Simulate building args + env copy
  const _args = ['--print', '--output-format', 'stream-json', '--verbose', '--model', 'opus']
  const _env = { ...process.env }
  delete _env.CLAUDECODE
  // Simulate result parsing
  JSON.parse('{"type":"result","result":"hello","session_id":"s1"}')
  return performance.now() - start
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Collect N timing samples, return sorted array */
function collectTimings(fn: () => number | Promise<number>, n: number): Promise<number[]> {
  return Promise.all(Array.from({ length: n }, () => fn())).then((arr) => arr.sort((a, b) => a - b))
}

function p50(arr: number[]): number {
  return arr[Math.floor(arr.length * 0.5)]
}
function p95(arr: number[]): number {
  return arr[Math.floor(arr.length * 0.95)]
}
function avg(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

// ============ Benchmarks ============

describe('PersistentProcess performance benchmarks', () => {
  let mockProc: MockProc

  beforeEach(() => {
    vi.clearAllMocks()
    mockProc = createMockProc()
    mockedExeca.mockReturnValue(mockProc as never)
  })

  // ---------- 1. Message injection latency (stdin write → first event) ----------

  it('stdin injection latency < 100ms (POC criterion)', async () => {
    const pp = new PersistentProcess({ model: 'opus' })
    pp.start()

    const samples: number[] = []
    const ROUNDS = 20

    for (let i = 0; i < ROUNDS; i++) {
      const start = performance.now()

      // sendMessage writes to stdin — start timing
      const msgPromise = pp.sendMessage(`round ${i}`)

      // Simulate the process responding immediately
      await sleep(1) // yield to let write flush
      const writeLatency = performance.now() - start
      samples.push(writeLatency)

      // Emit system init + result to resolve the sendMessage promise
      emitLine(mockProc, { type: 'system', subtype: 'init', session_id: 's1' })
      emitLine(mockProc, { type: 'result', result: 'ok', session_id: 's1', total_cost_usd: 0 })

      await msgPromise
    }

    samples.sort((a, b) => a - b)
    const p50Val = p50(samples)
    const p95Val = p95(samples)

    console.log(`[Injection Latency] samples=${ROUNDS}, p50=${p50Val.toFixed(2)}ms, p95=${p95Val.toFixed(2)}ms`)

    // POC criterion: injection latency < 100ms
    expect(p95Val).toBeLessThan(100)
    // In practice with mocks, should be < 5ms
    expect(p50Val).toBeLessThan(10)
  })

  // ---------- 2. Cold start vs warm comparison ----------

  it('warm message latency significantly lower than cold start', async () => {
    const COLD_START_MS = 50 // simulated process spawn overhead
    const ROUNDS = 10

    // Cold start: each message requires a new "process"
    const coldTimings = await collectTimings(() => simulateOneShotCycle(COLD_START_MS), ROUNDS)

    // Warm: persistent process already running, just stdin write
    const pp = new PersistentProcess({ model: 'opus' })
    pp.start()

    const warmTimings: number[] = []
    for (let i = 0; i < ROUNDS; i++) {
      const start = performance.now()
      const msgPromise = pp.sendMessage(`msg ${i}`)
      await sleep(0)
      warmTimings.push(performance.now() - start)
      emitLine(mockProc, { type: 'system', subtype: 'init', session_id: 's1' })
      emitLine(mockProc, { type: 'result', result: 'ok', session_id: 's1' })
      await msgPromise
    }
    warmTimings.sort((a, b) => a - b)

    const coldP50 = p50(coldTimings)
    const warmP50 = p50(warmTimings)
    const speedup = coldP50 / warmP50

    console.log(`[Cold vs Warm] cold p50=${coldP50.toFixed(2)}ms, warm p50=${warmP50.toFixed(2)}ms, speedup=${speedup.toFixed(1)}x`)

    // Warm should be at least 5x faster than cold (no spawn overhead)
    expect(speedup).toBeGreaterThan(5)
  })

  // ---------- 3. Event parsing throughput ----------

  it('event parsing throughput > 10000 events/sec', () => {
    const pp = new PersistentProcess({ model: 'opus' })
    pp.start()

    const events: PersistentProcessEvent[] = []
    pp.on('event', (e: PersistentProcessEvent) => events.push(e))

    // Build a large batch of stream lines and emit as a single chunk
    // (simulates high-throughput stdout data from the CLI)
    const N = 1000
    const lines: string[] = []
    for (let i = 0; i < N; i++) {
      lines.push(JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: `token${i}` },
        },
      }))
    }
    const payload = lines.join('\n') + '\n'

    const start = performance.now()
    mockProc.stdout.emit('data', Buffer.from(payload))
    const elapsed = performance.now() - start
    const throughput = (N / elapsed) * 1000

    console.log(`[Parse Throughput] ${N} events in ${elapsed.toFixed(2)}ms = ${throughput.toFixed(0)} events/sec`)

    expect(events.length).toBe(N)
    expect(throughput).toBeGreaterThan(10000)
  })

  // ---------- 4. Memory overhead: single PersistentProcess ----------

  it('PersistentProcess memory overhead is reasonable', () => {
    // Measure baseline
    const before = process.memoryUsage()

    const instances: PersistentProcess[] = []
    const procs: MockProc[] = []
    const COUNT = 50

    for (let i = 0; i < COUNT; i++) {
      const proc = createMockProc()
      procs.push(proc)
      mockedExeca.mockReturnValueOnce(proc as never)
      const pp = new PersistentProcess({ model: 'opus' })
      pp.start()
      instances.push(pp)
    }

    const after = process.memoryUsage()
    const heapDelta = (after.heapUsed - before.heapUsed) / 1024 / 1024 // MB
    const perInstance = heapDelta / COUNT

    console.log(`[Memory] ${COUNT} instances: total heap delta=${heapDelta.toFixed(2)}MB, per instance=${(perInstance * 1024).toFixed(1)}KB`)

    // Each instance should use < 100KB of heap
    expect(perInstance).toBeLessThan(0.1) // 0.1 MB = 100 KB
  })

  // ---------- 5. Token reuse architecture validation ----------

  it('session reuse: second message shares session_id (token cache eligible)', async () => {
    const pp = new PersistentProcess({ model: 'opus' })
    pp.start()

    const sessionIds: string[] = []
    pp.on('event', (e: PersistentProcessEvent) => {
      if (e.type === 'system_init') sessionIds.push(e.sessionId)
      if (e.type === 'result') sessionIds.push(e.sessionId)
    })

    // Round 1
    const msg1 = pp.sendMessage('hello')
    await sleep(1)
    emitLine(mockProc, { type: 'system', subtype: 'init', session_id: 'session-abc' })
    emitLine(mockProc, {
      type: 'result',
      result: 'hi',
      session_id: 'session-abc',
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, cache_creation_input_tokens: 80, cache_read_input_tokens: 0, output_tokens: 20 },
    })
    await msg1

    // Round 2 — same process, same session
    const msg2 = pp.sendMessage('follow up')
    await sleep(1)
    emitLine(mockProc, { type: 'system', subtype: 'init', session_id: 'session-abc' })
    emitLine(mockProc, {
      type: 'result',
      result: 'ok',
      session_id: 'session-abc',
      total_cost_usd: 0.005,
      usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 80, output_tokens: 15 },
    })
    await msg2

    // Verify same session_id across rounds (prerequisite for prompt cache reuse)
    expect(sessionIds).toEqual([
      'session-abc', 'session-abc', // round 1: init + result
      'session-abc', 'session-abc', // round 2: init + result
    ])

    // Verify execa was called only once (process reused)
    expect(mockedExeca).toHaveBeenCalledTimes(1)

    console.log('[Session Reuse] Confirmed: same session_id across 2 rounds, single process spawn')
  })

  // ---------- 6. State transition speed ----------

  it('state transitions are instantaneous', async () => {
    const pp = new PersistentProcess({ model: 'opus' })
    pp.start()
    expect(pp.getState()).toBe('idle')

    const transitions: { state: string; time: number }[] = []
    const t0 = performance.now()

    // idle → busy
    const msgPromise = pp.sendMessage('test')
    transitions.push({ state: pp.getState(), time: performance.now() - t0 })

    await sleep(1)

    // busy → idle (on result)
    emitLine(mockProc, { type: 'system', subtype: 'init', session_id: 's1' })
    emitLine(mockProc, { type: 'result', result: 'ok', session_id: 's1' })
    await msgPromise
    transitions.push({ state: pp.getState(), time: performance.now() - t0 })

    console.log('[State Transitions]', transitions.map((t) => `${t.state}@${t.time.toFixed(2)}ms`).join(' → '))

    expect(transitions[0].state).toBe('busy')
    expect(transitions[1].state).toBe('idle')
    // Both transitions should happen within 50ms (excluding sleep)
    expect(transitions[0].time).toBeLessThan(50)
  })
})

// ============ Real CLI benchmarks (optional) ============

const BENCH_REAL_CLI = process.env.BENCH_REAL_CLI === '1'

describe.skipIf(!BENCH_REAL_CLI)('Real CLI benchmarks (BENCH_REAL_CLI=1)', () => {
  it('real persistent vs one-shot comparison', async () => {
    // Dynamic import to avoid mock interference
    const { createPersistentProcess } = await import('../../src/backend/PersistentProcess.js')
    const { execa: realExeca } = await import('execa')

    console.log('\n--- Real CLI Benchmark ---')

    // One-shot: spawn → result → exit
    const oneShotStart = performance.now()
    const oneShot = await realExeca('claude', [
      '--print',
      '--output-format', 'json',
      '--model', 'haiku',
      '--dangerously-skip-permissions',
      'Say "hello" and nothing else',
    ], { stdin: 'ignore' })
    const oneShotMs = performance.now() - oneShotStart
    console.log(`[One-shot] ${oneShotMs.toFixed(0)}ms`)

    // Persistent: first message (cold) + second message (warm)
    const pp = createPersistentProcess({ model: 'haiku' })

    const warmStart = performance.now()
    await new Promise<void>((resolve) => {
      pp.on('event', (e: PersistentProcessEvent) => {
        if (e.type === 'result') resolve()
      })
      pp.sendMessage('Say "hello" and nothing else')
    })
    const coldMs = performance.now() - warmStart

    const warm2Start = performance.now()
    await new Promise<void>((resolve) => {
      const handler = (e: PersistentProcessEvent) => {
        if (e.type === 'result') {
          pp.removeListener('event', handler)
          resolve()
        }
      }
      pp.on('event', handler)
      pp.sendMessage('Say "world" and nothing else')
    })
    const warmMs = performance.now() - warm2Start

    await pp.shutdown()

    console.log(`[Persistent cold] ${coldMs.toFixed(0)}ms`)
    console.log(`[Persistent warm] ${warmMs.toFixed(0)}ms`)
    console.log(`[Speedup] warm vs one-shot: ${(oneShotMs / warmMs).toFixed(1)}x`)
  }, 120_000)
})
