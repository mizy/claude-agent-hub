/**
 * PersistentProcess tests — process lifecycle and stdout parsing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  type MockSubprocess,
  createMockSubprocess,
  emitProcessExit,
  emitStdoutLine,
} from './persistent-process-helpers.js'

import { execa } from 'execa'
import { PersistentProcess } from '../src/backend/PersistentProcess.js'

// ============ Process lifecycle ============

describe('PersistentProcess — process lifecycle', () => {
  let mockProc: MockSubprocess

  beforeEach(() => {
    mockProc = createMockSubprocess()
    vi.mocked(execa).mockReturnValue(mockProc as unknown as ReturnType<typeof execa>)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('start() spawns process with correct args', () => {
    const pp = new PersistentProcess({ model: 'sonnet', skipPermissions: true })
    pp.start()

    expect(execa).toHaveBeenCalledOnce()
    const [cmd, args] = vi.mocked(execa).mock.calls[0] as [string, string[]]
    expect(cmd).toBe('claude')
    expect(args).toContain('--model')
    expect(args).toContain('sonnet')
    expect(args).toContain('--output-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--input-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).toContain('--include-partial-messages')
  })

  it('start() sets state to idle', () => {
    const pp = new PersistentProcess()
    pp.start()
    expect(pp.getState()).toBe('idle')
    expect(pp.isAlive()).toBe(true)
  })

  it('start() throws if called twice', () => {
    const pp = new PersistentProcess()
    pp.start()
    expect(() => pp.start()).toThrow('Process already started')
  })

  it('buildArgs includes --resume when sessionId provided', () => {
    const pp = new PersistentProcess({ sessionId: 'sess-123' })
    pp.start()
    const [, args] = vi.mocked(execa).mock.calls[0] as [string, string[]]
    expect(args).toContain('--resume')
    expect(args).toContain('sess-123')
  })

  it('buildArgs includes --effort when variant provided', () => {
    const pp = new PersistentProcess({ variant: 'low' })
    pp.start()
    const [, args] = vi.mocked(execa).mock.calls[0] as [string, string[]]
    expect(args).toContain('--effort')
    expect(args).toContain('low')
  })

  it('buildArgs includes --append-system-prompt when systemPrompt provided', () => {
    const pp = new PersistentProcess({ systemPrompt: 'Be concise' })
    pp.start()
    const [, args] = vi.mocked(execa).mock.calls[0] as [string, string[]]
    expect(args).toContain('--append-system-prompt')
    expect(args).toContain('Be concise')
  })

  it('process unexpected exit sets state to closed and emits exit event', () => {
    const pp = new PersistentProcess()
    pp.start()

    const events: unknown[] = []
    pp.on('event', (e) => events.push(e))

    emitProcessExit(mockProc, 1)

    expect(pp.getState()).toBe('closed')
    expect(pp.isAlive()).toBe(false)
    expect(events).toContainEqual({ type: 'exit', code: 1 })
  })

  it('process exit with code null emits exit event', () => {
    const pp = new PersistentProcess()
    pp.start()

    const events: unknown[] = []
    pp.on('event', (e) => events.push(e))

    emitProcessExit(mockProc, null)

    expect(events).toContainEqual({ type: 'exit', code: null })
  })

  it('shutdown() closes stdin and waits for exit', async () => {
    const pp = new PersistentProcess({ shutdownTimeoutMs: 500 })
    pp.start()

    const shutdownPromise = pp.shutdown()
    setTimeout(() => emitProcessExit(mockProc, 0), 10)

    await shutdownPromise
    expect(pp.getState()).toBe('closed')
    expect(pp.isAlive()).toBe(false)
  })

  it('shutdown() force kills if graceful timeout exceeded', async () => {
    const pp = new PersistentProcess({ shutdownTimeoutMs: 50 })
    pp.start()

    await pp.shutdown()

    expect(mockProc.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('shutdown() is safe when process not started', async () => {
    const pp = new PersistentProcess()
    await expect(pp.shutdown()).resolves.toBeUndefined()
    expect(pp.getState()).toBe('closed')
  })

  it('sendMessage throws when process not started', async () => {
    const pp = new PersistentProcess()
    await expect(pp.sendMessage('hello')).rejects.toThrow('Process is not running')
  })

  it('sendMessage throws when state is busy', async () => {
    const pp = new PersistentProcess()
    pp.start()

    const firstDone = pp.sendMessage('first')
    await new Promise((r) => setTimeout(r, 10))

    await expect(pp.sendMessage('second')).rejects.toThrow('Process is busy')

    emitStdoutLine(mockProc, { type: 'result', session_id: 's' })
    await firstDone
  })

  it('shutdown rejects pending sendMessage', async () => {
    const pp = new PersistentProcess({ shutdownTimeoutMs: 200 })
    pp.start()

    const sendPromise = pp.sendMessage('hello')
    await new Promise((r) => setTimeout(r, 5))

    const shutdownPromise = pp.shutdown()
    emitProcessExit(mockProc, 0)
    await shutdownPromise

    await expect(sendPromise).rejects.toThrow('shutting down')
  })
})

// ============ stdout parsing ============

describe('PersistentProcess — stdout parsing', () => {
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

  function collectEvents(): unknown[] {
    const events: unknown[] = []
    pp.on('event', (e) => events.push(e))
    return events
  }

  it('parses content_block_delta text event', () => {
    const events = collectEvents()

    emitStdoutLine(mockProc, {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello world' },
      },
    })

    expect(events).toContainEqual({ type: 'text_delta', text: 'Hello world' })
  })

  it('parses assistant message with text content', () => {
    const events = collectEvents()

    emitStdoutLine(mockProc, {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Assistant reply' }],
      },
    })

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'assistant', text: 'Assistant reply' })
    )
  })

  it('parses tool_use from assistant message', () => {
    const events = collectEvents()

    emitStdoutLine(mockProc, {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'Bash',
            input: { command: 'ls -la', description: 'List files' },
          },
        ],
      },
    })

    expect(events).toContainEqual({
      type: 'tool_use',
      id: 'toolu_abc',
      name: 'Bash',
      input: { command: 'ls -la', description: 'List files' },
    })
  })

  it('parses assistant message with multiple blocks including tool_use', () => {
    const events = collectEvents()

    emitStdoutLine(mockProc, {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Running command...' },
          { type: 'tool_use', id: 'toolu_xyz', name: 'Read', input: { file_path: '/tmp/x' } },
        ],
      },
    })

    const toolUseEvents = events.filter((e) => (e as { type: string }).type === 'tool_use')
    const assistantEvents = events.filter((e) => (e as { type: string }).type === 'assistant')

    expect(toolUseEvents).toHaveLength(1)
    expect(assistantEvents).toHaveLength(1)
    expect(toolUseEvents[0]).toMatchObject({ type: 'tool_use', id: 'toolu_xyz', name: 'Read' })
  })

  it('parses system init event and extracts sessionId', () => {
    const events = collectEvents()

    emitStdoutLine(mockProc, {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-abc123',
    })

    expect(events).toContainEqual({ type: 'system_init', sessionId: 'sess-abc123' })
  })

  it('parses result event and resets state to idle', () => {
    const events = collectEvents()

    ;(pp as unknown as { state: string }).state = 'busy'

    emitStdoutLine(mockProc, {
      type: 'result',
      session_id: 'sess-xyz',
      total_cost_usd: 0.005,
      duration_api_ms: 1200,
    })

    expect(pp.getState()).toBe('idle')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'result',
        sessionId: 'sess-xyz',
        costUsd: 0.005,
        durationApiMs: 1200,
      })
    )
  })

  it('parses tool_result echo (user event with tool_use_id)', () => {
    const events = collectEvents()

    emitStdoutLine(mockProc, {
      type: 'user',
      tool_use_id: 'toolu_abc',
      tool_use_result: {
        stdout: 'file contents here',
        stderr: '',
      },
    })

    expect(events).toContainEqual({
      type: 'tool_result',
      toolUseId: 'toolu_abc',
      stdout: 'file contents here',
      stderr: '',
    })
  })

  it('silently ignores malformed JSON lines', () => {
    const events = collectEvents()
    mockProc.stdout.emit(
      'data',
      Buffer.from('not valid json\n' + JSON.stringify({ type: 'system', session_id: 'ok' }) + '\n')
    )

    expect(events).toContainEqual({ type: 'system_init', sessionId: 'ok' })
  })

  it('handles incomplete lines across two chunks', () => {
    const events = collectEvents()

    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'split' } },
    })

    const mid = Math.floor(line.length / 2)
    mockProc.stdout.emit('data', Buffer.from(line.slice(0, mid)))
    mockProc.stdout.emit('data', Buffer.from(line.slice(mid) + '\n'))

    expect(events).toContainEqual({ type: 'text_delta', text: 'split' })
  })

  it('ignores empty/whitespace lines', () => {
    const events = collectEvents()
    mockProc.stdout.emit('data', Buffer.from('   \n\n\t\n'))
    expect(events).toHaveLength(0)
  })
})
