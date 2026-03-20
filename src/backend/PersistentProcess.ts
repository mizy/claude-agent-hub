/**
 * Persistent Claude CLI process with bidirectional stream-json communication
 *
 * Maintains a long-running claude CLI process, allowing multiple user messages
 * to be sent via stdin without respawning. Context is shared across messages
 * within the same session, eliminating cold-start overhead.
 *
 * @entry
 */

import { execa, type ResultPromise } from 'execa'
import { EventEmitter } from 'events'
import { createLogger } from '../shared/logger.js'
import type { StreamJsonEvent, StreamContentBlock, ExtractedEventMetrics } from './claudeCompatHelpers.js'
import {
  extractEventTextDelta,
  extractEventMetrics,
  extractEventError,
  extractEventSessionId,
  extractAssistantTextFromEvent,
} from './claudeCompatHelpers.js'

const logger = createLogger('persistent-process')

// ============ Types ============

export interface PersistentProcessOptions {
  /** CLI binary name (default: 'claude') — e.g. 'codebuddy', 'cbc' */
  binary?: string
  /** Working directory for the CLI process */
  cwd?: string
  /** Model to use (default: 'opus') */
  model?: string
  /** System prompt appended via --append-system-prompt */
  systemPrompt?: string
  /** Skip permission prompts (default: true) */
  skipPermissions?: boolean
  /** Include per-token partial messages (default: true) */
  includePartialMessages?: boolean
  /** Inference effort: 'low' | 'medium' | 'high' */
  variant?: string
  /** Session ID to resume */
  sessionId?: string
  /** Timeout for graceful shutdown in ms (default: 5000) */
  shutdownTimeoutMs?: number
}

/** Discriminated union of all events emitted by PersistentProcess */
export type PersistentProcessEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'assistant'; text: string; content: StreamContentBlock[] }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; stdout?: string; stderr?: string }
  | { type: 'result'; sessionId: string; costUsd?: number; durationApiMs?: number; metrics: ExtractedEventMetrics }
  | { type: 'error'; message: string }
  | { type: 'system_init'; sessionId: string }
  | { type: 'exit'; code: number | null }

export type PersistentProcessState = 'idle' | 'busy' | 'closed'

// ============ PersistentProcess ============

export class PersistentProcess extends EventEmitter {
  private subprocess: ResultPromise | null = null
  private buffer = ''
  private state: PersistentProcessState = 'idle'
  private writeQueue: { data: string; resolve: () => void; reject: (err: Error) => void }[] = []
  private writing = false
  private pendingWrite: { resolve: () => void; reject: (err: Error) => void } | null = null
  private resultResolver: { resolve: () => void; reject: (err: Error) => void } | null = null
  private aborted = false
  private options: Required<
    Pick<PersistentProcessOptions, 'binary' | 'cwd' | 'model' | 'skipPermissions' | 'includePartialMessages' | 'shutdownTimeoutMs'>
  > &
    PersistentProcessOptions

  constructor(options: PersistentProcessOptions = {}) {
    super()
    this.setMaxListeners(20)
    this.options = {
      binary: options.binary ?? 'claude',
      cwd: options.cwd ?? process.cwd(),
      model: options.model ?? 'opus',
      skipPermissions: options.skipPermissions ?? true,
      includePartialMessages: options.includePartialMessages ?? true,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 5000,
      systemPrompt: options.systemPrompt,
      variant: options.variant,
      sessionId: options.sessionId,
    }
  }

  /** Current process state */
  getState(): PersistentProcessState {
    return this.state
  }

  /** Spawn the persistent CLI process */
  start(): void {
    if (this.subprocess) {
      throw new Error('Process already started')
    }

    const args = this.buildArgs()
    const env = { ...process.env }
    // Remove CLAUDECODE to avoid nested claude CLI detection
    delete env.CLAUDECODE

    const binary = this.options.binary
    logger.info(`Spawning persistent process: ${binary} ${args.join(' ')}`)

    this.subprocess = execa(binary, args, {
      cwd: this.options.cwd,
      stdin: 'pipe',
      buffer: { stdout: false, stderr: true },
      env,
    })

    // Prevent unhandled rejection — execa rejects on non-zero exit,
    // but we handle exit via the 'exit' event handler
    this.subprocess.catch(() => {})

    this.setupStdoutParsing()
    this.setupExitHandler()
    this.state = 'idle'
  }

  /**
   * Send a user message and wait for the result event (response complete).
   * Resolves when the claude CLI emits a 'result' event for this message round.
   */
  async sendMessage(content: string): Promise<void> {
    this.ensureAlive()
    if (this.state === 'busy') {
      throw new Error('Process is busy handling a previous message, wait for result event')
    }

    this.state = 'busy'
    this.aborted = false

    // Create result promise BEFORE writing to stdin to avoid race condition
    const resultPromise = new Promise<void>((resolve, reject) => {
      this.resultResolver = { resolve, reject }
    })

    const msg = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: content }],
      },
    }
    await this.writeStdin(JSON.stringify(msg))
    await resultPromise
  }

  /**
   * Send a tool result back to the process.
   * Use this when implementing external tool handling.
   * Should only be called when state is 'busy' (after receiving a tool_use event).
   */
  async sendToolResult(toolUseId: string, result: string, isError = false): Promise<void> {
    this.ensureAlive()
    if (this.state !== 'busy') {
      logger.warn(`sendToolResult called in state '${this.state}', expected 'busy'`)
    }
    const msg = {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: result,
      is_error: isError,
    }
    await this.writeStdin(JSON.stringify(msg))
  }

  /** Graceful shutdown: close stdin, wait for exit, force kill on timeout */
  async shutdown(): Promise<void> {
    if (!this.subprocess) {
      this.state = 'closed'
      return
    }

    this.state = 'closed'
    const proc = this.subprocess

    // Close stdin to signal EOF — process will exit after current work
    try {
      proc.stdin?.end()
    } catch {
      // stdin may already be closed
    }

    // Reject any pending write waiting on drain
    this.rejectPendingWrite(new Error('Process shutting down'))

    // Reject any pending sendMessage awaiting result
    if (this.resultResolver) {
      this.resultResolver.reject(new Error('Process shutting down'))
      this.resultResolver = null
    }

    // Wait for graceful exit or force kill
    const timeoutMs = this.options.shutdownTimeoutMs
    const exitPromise = new Promise<boolean>((resolve) => {
      proc.on('exit', () => resolve(true))
      if (proc.exitCode !== null) resolve(true)
    })
    const exited = await Promise.race([
      exitPromise,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ])
    if (!exited) {
      logger.warn(`Graceful shutdown timed out after ${timeoutMs}ms, sending SIGKILL`)
      proc.kill('SIGKILL')
    }

    this.subprocess = null
  }

  /** Check if the process is alive */
  isAlive(): boolean {
    return this.subprocess !== null && this.state !== 'closed'
  }

  /**
   * Abort the current in-flight message.
   * Rejects the pending sendMessage promise and transitions state back to idle,
   * so the process can accept new messages without being stuck in busy.
   * The process remains alive — the CLI will still emit events for the aborted
   * request (assistant, result), which are silently discarded via the aborted flag.
   */
  abort(): void {
    if (this.state !== 'busy') return
    this.aborted = true
    this.state = 'idle'
    if (this.resultResolver) {
      this.resultResolver.reject(new Error('Aborted'))
      this.resultResolver = null
    }
    logger.debug('Aborted in-flight message, process remains alive for reuse')
  }

  // ============ Private ============

  private buildArgs(): string[] {
    const { model, skipPermissions, includePartialMessages, systemPrompt, variant, sessionId } = this.options
    const args: string[] = []

    if (sessionId) args.push('--resume', sessionId)
    if (model) args.push('--model', model)
    if (variant) args.push('--effort', normalizeClaudeEffort(variant))

    args.push('--print')
    args.push('--output-format', 'stream-json')
    args.push('--input-format', 'stream-json')
    args.push('--verbose')
    if (includePartialMessages) args.push('--include-partial-messages')
    if (skipPermissions) args.push('--dangerously-skip-permissions')
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt)

    return args
  }

  private setupStdoutParsing(): void {
    if (!this.subprocess) return

    const stdout = this.subprocess.stdout
    if (!stdout) {
      logger.error('No stdout available from subprocess')
      return
    }

    stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      const lines = this.buffer.split('\n')
      // Keep the last incomplete line in buffer
      this.buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.trim()) this.processLine(line)
      }
    })
  }

  private processLine(line: string): void {
    let rawEvent: Record<string, unknown>
    try {
      rawEvent = JSON.parse(line) as Record<string, unknown>
    } catch {
      logger.debug(`Failed to parse stream line: ${line.slice(0, 120)}`)
      return
    }

    const event = rawEvent as unknown as StreamJsonEvent

    // Result event — marks end of one message round (check before error extraction
    // to prevent result events with error-like fields from being misrouted)
    if (event.type === 'result') {
      const sessionId = extractEventSessionId(rawEvent) ?? ''
      const metrics = extractEventMetrics(rawEvent)
      const wasAborted = this.aborted
      this.aborted = false
      this.state = 'idle'
      // Resolve the sendMessage promise waiting for completion
      if (this.resultResolver) {
        this.resultResolver.resolve()
        this.resultResolver = null
      }
      // Discard result from an aborted message — the abort() caller already handled it
      if (wasAborted) {
        logger.debug('Discarding result event from aborted message')
        return
      }
      this.emit('event', {
        type: 'result',
        sessionId,
        costUsd: metrics.costUsd,
        durationApiMs: metrics.durationApiMs,
        metrics,
      } satisfies PersistentProcessEvent)
      return
    }

    // When aborted, silently discard non-result events until the result event drains
    if (this.aborted) return

    // Error events
    const errorMsg = extractEventError(rawEvent)
    if (errorMsg) {
      this.emit('event', { type: 'error', message: errorMsg } satisfies PersistentProcessEvent)
      return
    }

    // Text deltas
    const deltaText = extractEventTextDelta(rawEvent)
    if (deltaText) {
      this.emit('event', { type: 'text_delta', text: deltaText } satisfies PersistentProcessEvent)
      return
    }

    // System init
    if (event.type === 'system') {
      const sessionId = extractEventSessionId(rawEvent) ?? ''
      this.emit('event', { type: 'system_init', sessionId } satisfies PersistentProcessEvent)
      return
    }

    // Assistant message (complete)
    if (event.type === 'assistant' && event.message?.content) {
      const text = extractAssistantTextFromEvent(event)
      const content = event.message.content

      // Emit tool_use events for each tool call in the message
      for (const block of content) {
        if (block.type === 'tool_use' && block.id && block.name) {
          this.emit('event', {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          } satisfies PersistentProcessEvent)
        }
      }

      this.emit('event', { type: 'assistant', text, content } satisfies PersistentProcessEvent)
      return
    }

    // Tool result echoed back — check top-level fields first, then message.content
    if (event.type === 'user') {
      if (event.tool_use_id && event.tool_use_result !== undefined) {
        this.emit('event', {
          type: 'tool_result',
          toolUseId: event.tool_use_id,
          stdout: event.tool_use_result?.stdout,
          stderr: event.tool_use_result?.stderr,
        } satisfies PersistentProcessEvent)
        return
      }
      // Also handle tool_result nested inside message.content
      const blocks = event.message?.content ?? (Array.isArray(event.content) ? event.content : undefined)
      if (blocks) {
        for (const block of blocks) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            this.emit('event', {
              type: 'tool_result',
              toolUseId: block.tool_use_id,
              stdout: typeof block.content === 'string' ? block.content : undefined,
            } satisfies PersistentProcessEvent)
          }
        }
        return
      }
    }
  }

  private setupExitHandler(): void {
    if (!this.subprocess) return
    const proc = this.subprocess

    this.subprocess.on('exit', (code) => {
      logger.info(`Persistent process exited with code ${code}`)
      // If already shutdown, skip cleanup (shutdown() already handled it)
      if (this.state === 'closed' && !this.subprocess) return

      // Flush any remaining complete line in buffer
      if (this.buffer.trim()) {
        this.processLine(this.buffer)
        this.buffer = ''
      }
      this.state = 'closed'
      this.subprocess = null
      // Reject any pending write waiting on drain
      this.rejectPendingWrite(new Error('Process exited'))
      // Reject any pending sendMessage awaiting result — process exited before completing
      if (this.resultResolver) {
        this.resultResolver.reject(new Error(`Process exited unexpectedly with code ${code}`))
        this.resultResolver = null
      }
      // Surface stderr on non-zero exit — execa rejects on non-zero, stderr is on the error object
      if (code !== 0) {
        proc.catch?.((err: unknown) => {
          const stderr = (err as { stderr?: string })?.stderr
          if (stderr) this.emit('event', { type: 'error', message: stderr } satisfies PersistentProcessEvent)
        })
      }
      this.emit('event', { type: 'exit', code } satisfies PersistentProcessEvent)
    })
  }

  /** Write a line to stdin with queue to prevent concurrent writes */
  private writeStdin(data: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.writeQueue.push({ data: data + '\n', resolve, reject })
      if (!this.writing) this.drainWriteQueue()
    })
  }

  private async drainWriteQueue(): Promise<void> {
    this.writing = true
    try {
      while (this.writeQueue.length > 0) {
        const item = this.writeQueue.shift()!
        try {
          await new Promise<void>((resolve, reject) => {
            if (!this.subprocess?.stdin) {
              reject(new Error('stdin not available'))
              return
            }
            const ok = this.subprocess.stdin.write(item.data)
            if (ok) {
              resolve()
            } else {
              this.pendingWrite = { resolve, reject }
              this.subprocess.stdin.once('drain', () => {
                this.pendingWrite = null
                resolve()
              })
            }
          })
          item.resolve()
        } catch (err) {
          item.reject(err as Error)
        }
      }
    } finally {
      this.writing = false
    }
  }

  private rejectPendingWrite(err: Error): void {
    const queued = this.writeQueue.splice(0)
    for (const item of queued) item.reject(err)
    if (this.pendingWrite) {
      this.pendingWrite.reject(err)
      this.pendingWrite = null
      // Remove orphaned drain listener to prevent memory leak
      this.subprocess?.stdin?.removeAllListeners('drain')
    }
  }

  private ensureAlive(): void {
    if (!this.subprocess || this.state === 'closed') {
      throw new Error('Process is not running, call start() first')
    }
  }
}

// ============ Helpers ============

/** Normalize effort/variant string to valid CLI values (shared with claudeCodeBackend) */
export function normalizeClaudeEffort(variant: string): 'low' | 'medium' | 'high' {
  const v = variant.trim().toLowerCase()
  if (v === 'minimal' || v === 'low') return 'low'
  if (v === 'max' || v === 'high') return 'high'
  return 'medium'
}

// ============ Factory ============

/** Create and start a persistent Claude CLI process */
export function createPersistentProcess(options?: PersistentProcessOptions): PersistentProcess {
  const proc = new PersistentProcess(options)
  proc.start()
  return proc
}
