/**
 * PersistentProcess tests — stdin injection and integration scenarios
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  type MockSubprocess,
  createMockSubprocess,
  emitProcessExit,
  emitStdoutLine,
} from './persistent-process-helpers.js'

import { execa } from 'execa'
import { PersistentProcess, createPersistentProcess } from '../src/backend/PersistentProcess.js'

// ============ stdin injection ============

describe('PersistentProcess — stdin injection', () => {
  let mockProc: MockSubprocess
  let pp: PersistentProcess

  beforeEach(() => {
    mockProc = createMockSubprocess()
    vi.mocked(execa).mockReturnValue(mockProc as unknown as ReturnType<typeof execa>)
    pp = new PersistentProcess()
    pp.start()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('sendMessage writes correct stream-json user format', async () => {
    const sendPromise = pp.sendMessage('What is 2+2?')

    await new Promise((r) => setTimeout(r, 10))

    const written = mockProc.stdin.written
    expect(written.length).toBeGreaterThan(0)

    const parsed = JSON.parse(written[0].trim())
    expect(parsed).toMatchObject({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'What is 2+2?' }],
      },
    })

    emitStdoutLine(mockProc, { type: 'result', session_id: 's', total_cost_usd: 0 })
    await sendPromise
  })

  it('sendToolResult writes correct stream-json tool_result format', async () => {
    ;(pp as unknown as { state: string }).state = 'busy'

    await pp.sendToolResult('toolu_123', 'hello output', false)
    await new Promise((r) => setTimeout(r, 10))

    const written = mockProc.stdin.written
    const parsed = JSON.parse(written[0].trim())
    expect(parsed).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_123',
      content: 'hello output',
      is_error: false,
    })
  })

  it('sendToolResult with isError=true writes is_error: true', async () => {
    ;(pp as unknown as { state: string }).state = 'busy'
    await pp.sendToolResult('toolu_err', 'command failed', true)
    await new Promise((r) => setTimeout(r, 10))

    const written = mockProc.stdin.written
    const parsed = JSON.parse(written[0].trim())
    expect(parsed.is_error).toBe(true)
  })

  it('concurrent sendToolResult calls are serialized via queue', async () => {
    ;(pp as unknown as { state: string }).state = 'busy'

    const p1 = pp.sendToolResult('t1', 'result 1')
    const p2 = pp.sendToolResult('t2', 'result 2')
    await Promise.all([p1, p2])
    await new Promise((r) => setTimeout(r, 20))

    const written = mockProc.stdin.written
    expect(written.length).toBe(2)

    const ids = written.map((w) => JSON.parse(w.trim()).tool_use_id)
    expect(ids).toContain('t1')
    expect(ids).toContain('t2')
  })

  it('sendMessage throws after process exits', async () => {
    emitProcessExit(mockProc, 0)
    await expect(pp.sendMessage('hello')).rejects.toThrow('Process is not running')
  })
})

// ============ Integration scenarios ============

describe('PersistentProcess — integration scenarios', () => {
  let mockProc: MockSubprocess
  let pp: PersistentProcess

  beforeEach(() => {
    mockProc = createMockSubprocess()
    vi.mocked(execa).mockReturnValue(mockProc as unknown as ReturnType<typeof execa>)
    pp = new PersistentProcess({ shutdownTimeoutMs: 200 })
    pp.start()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('send prompt → receive streaming deltas → result event', async () => {
    const events: unknown[] = []
    pp.on('event', (e) => events.push(e))

    const sendPromise = pp.sendMessage('Hello')

    await new Promise((r) => setTimeout(r, 5))
    emitStdoutLine(mockProc, {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } },
    })
    emitStdoutLine(mockProc, {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there!' } },
    })
    emitStdoutLine(mockProc, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hi there!' }] },
    })
    emitStdoutLine(mockProc, {
      type: 'result',
      session_id: 'sess-1',
      total_cost_usd: 0.001,
      duration_api_ms: 800,
    })

    await sendPromise

    const types = events.map((e) => (e as { type: string }).type)
    expect(types).toContain('text_delta')
    expect(types).toContain('assistant')
    expect(types).toContain('result')

    const deltas = events.filter((e) => (e as { type: string }).type === 'text_delta')
    expect(deltas).toHaveLength(2)
    expect(pp.getState()).toBe('idle')
  })

  it('tool call flow: prompt → tool_use → inject tool_result → result', async () => {
    const events: unknown[] = []
    pp.on('event', (e) => events.push(e))

    const sendPromise = pp.sendMessage('List files')

    await new Promise((r) => setTimeout(r, 5))

    emitStdoutLine(mockProc, {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_ls', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    })

    await pp.sendToolResult('toolu_ls', 'file1.txt\nfile2.ts')

    emitStdoutLine(mockProc, {
      type: 'user',
      tool_use_id: 'toolu_ls',
      tool_use_result: { stdout: 'file1.txt\nfile2.ts', stderr: '' },
    })

    emitStdoutLine(mockProc, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Found 2 files.' }] },
    })
    emitStdoutLine(mockProc, {
      type: 'result',
      session_id: 'sess-2',
      total_cost_usd: 0.002,
    })

    await sendPromise

    const types = events.map((e) => (e as { type: string }).type)
    expect(types).toContain('tool_use')
    expect(types).toContain('tool_result')
    expect(types).toContain('assistant')
    expect(types).toContain('result')

    expect(pp.getState()).toBe('idle')
  })

  it('createPersistentProcess factory starts process immediately', () => {
    const proc = createPersistentProcess({ model: 'haiku' })
    expect(proc.getState()).toBe('idle')
    expect(proc.isAlive()).toBe(true)
    expect(execa).toHaveBeenCalled()
  })

  it('error event emitted for type:error event', () => {
    const events: unknown[] = []
    pp.on('event', (e) => events.push(e))

    emitStdoutLine(mockProc, {
      type: 'error',
      message: 'Something went wrong',
    })

    const errorEvents = events.filter((e) => (e as { type: string }).type === 'error')
    expect(errorEvents.length).toBeGreaterThan(0)
    expect(errorEvents[0]).toMatchObject({ type: 'error', message: 'Something went wrong' })
  })

  it('second message uses same process after first result', async () => {
    const send1 = pp.sendMessage('First')
    await new Promise((r) => setTimeout(r, 5))
    emitStdoutLine(mockProc, { type: 'result', session_id: 'sess-a' })
    await send1

    expect(pp.getState()).toBe('idle')

    const send2 = pp.sendMessage('Second')
    await new Promise((r) => setTimeout(r, 5))
    emitStdoutLine(mockProc, { type: 'result', session_id: 'sess-a' })
    await send2

    expect(execa).toHaveBeenCalledOnce()
    expect(pp.getState()).toBe('idle')
  })
})
