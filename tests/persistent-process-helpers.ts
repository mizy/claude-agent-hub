/**
 * Shared mock utilities for PersistentProcess tests
 */

import { vi } from 'vitest'
import { EventEmitter } from 'events'
import { Writable } from 'stream'

// ============ Mock setup (must be called before imports) ============

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

vi.mock('../src/shared/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// ============ Mock subprocess factory ============

export interface MockSubprocess extends EventEmitter {
  stdout: EventEmitter & { pipe?: unknown }
  stdin: Writable & { written: string[]; endCalled: boolean }
  exitCode: number | null
  kill: ReturnType<typeof vi.fn>
  catch: ReturnType<typeof vi.fn>
}

export function createMockSubprocess(): MockSubprocess {
  const proc = new EventEmitter() as MockSubprocess

  const stdout = new EventEmitter()
  proc.stdout = stdout as MockSubprocess['stdout']

  const written: string[] = []
  let endCalled = false
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      written.push(chunk.toString())
      cb()
    },
  }) as MockSubprocess['stdin']
  stdin.written = written
  stdin.endCalled = endCalled
  const originalEnd = stdin.end.bind(stdin)
  stdin.end = (...args: unknown[]) => {
    stdin.endCalled = true
    return originalEnd(...(args as Parameters<typeof originalEnd>))
  }
  proc.stdin = stdin

  proc.exitCode = null
  proc.kill = vi.fn((signal?: string) => {
    proc.exitCode = signal === 'SIGKILL' ? 137 : 0
    proc.emit('exit', proc.exitCode)
  })
  // execa returns a promise-like; PersistentProcess calls .catch() to suppress unhandled rejections
  proc.catch = vi.fn()

  return proc
}

export function emitProcessExit(proc: MockSubprocess, code: number | null = 0) {
  proc.exitCode = code
  proc.emit('exit', code)
}

export function emitStdoutLine(proc: MockSubprocess, obj: unknown) {
  proc.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'))
}
