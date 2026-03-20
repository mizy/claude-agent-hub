/**
 * Persistent Claude CLI invoke implementation
 *
 * Manages long-running PersistentProcess instances keyed by taskId,
 * translating PersistentProcess events into InvokeResult format.
 *
 * @entry
 */

import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { logCliCommand, buildRedactedCommand } from '../store/conversationLog.js'
import { PersistentProcess, type PersistentProcessEvent } from './PersistentProcess.js'
import { acquireSlot, releaseSlot } from './concurrency.js'
import type { InvokeOptions, InvokeResult, InvokeError } from './types.js'
import type { Result } from '../shared/result.js'

/** Default per-message timeout: 30 minutes (matches one-shot execa timeout) */
const DEFAULT_MESSAGE_TIMEOUT_MS = 30 * 60 * 1000

const logger = createLogger('persistent-claude')

// ============ Process Pool ============

/** Pool of persistent processes keyed by taskId (or cwd as fallback) */
const processPool = new Map<string, PersistentProcess>()

/** Cached sessionId per pool key — first system_init is consumed by waitForReady,
 *  so subsequent invoke calls can't get it from events. Cache it here. */
const sessionIdCache = new Map<string, string>()

/**
 * Get pool key from invoke options — prefer taskId from trace context, fallback to cwd.
 * Note: cwd fallback means two different non-task callers sharing the same cwd will
 * share one persistent process. In practice this only applies to interactive chat
 * sessions which are single-threaded per cwd.
 */
function getPoolKey(options: InvokeOptions): string {
  return options.traceCtx?.taskId ?? options.cwd ?? process.cwd()
}

/** Register exit listener on a process to proactively clean it from the pool and release its slot */
function registerPoolExitListener(poolKey: string, proc: PersistentProcess): void {
  const onExit = (event: PersistentProcessEvent) => {
    if (event.type === 'exit') {
      const current = processPool.get(poolKey)
      if (current === proc) {
        processPool.delete(poolKey)
        sessionIdCache.delete(poolKey)
        releaseSlot()
        logger.info(`Removed dead persistent process from pool: key=${poolKey}, code=${event.code}`)
      }
      proc.removeListener('event', onExit)
    }
  }
  proc.on('event', onExit)
}

/**
 * Invoke Claude CLI via persistent process.
 * First call for a given key creates and starts the process; subsequent calls reuse it.
 */
export async function invokePersistent(
  options: InvokeOptions
): Promise<Result<InvokeResult, InvokeError>> {
  const {
    prompt,
    systemPrompt,
    cwd = process.cwd(),
    onChunk,
    onToolUse,
    // sessionId from caller is ignored — persistent mode always creates new sessions
    model = 'opus',
    variant,
    skipPermissions = true,
    signal,
    disableMcp,
    mcpServers,
    attachments,
    timeoutMs,
    persistentBinary = 'claude',
  } = options

  // TODO: remove MCP support from InvokeOptions — persistent mode supersedes it
  if (disableMcp || mcpServers?.length) {
    logger.warn('Persistent mode does not support MCP config (disableMcp/mcpServers) — ignored')
  }
  if (attachments?.length) {
    logger.warn('Persistent mode does not support attachments — ignored')
  }
  if (timeoutMs) {
    logger.warn('Persistent mode does not support per-invoke timeoutMs — ignored')
  }
  if (options.firstByteTimeoutMs) {
    logger.warn('Persistent mode does not support firstByteTimeoutMs — ignored')
  }
  if (options.stream) {
    logger.warn('Persistent mode always uses stream-json — stream parameter ignored')
  }

  const poolKey = getPoolKey(options)
  const startTime = Date.now()

  // Log command for debugging
  logCliCommand({
    backend: `persistent-${persistentBinary}`,
    command: buildRedactedCommand(persistentBinary, ['--persistent'], prompt, systemPrompt),
    prompt: systemPrompt
      ? `[SYSTEM PROMPT]\n${systemPrompt}\n\n[USER PROMPT]\n${prompt}`
      : prompt,
    sessionId: sessionIdCache.get(poolKey),
    model,
    cwd,
  })

  // Wire up abort signal to call proc.abort() so the process returns to idle
  // instead of being stuck in busy state forever.
  const abortHandler = signal ? () => {
    const proc = processPool.get(poolKey)
    if (proc?.isAlive()) {
      proc.abort()
      logger.info(`Aborted persistent process for key=${poolKey}`)
    }
  } : undefined
  if (signal && abortHandler) {
    signal.addEventListener('abort', abortHandler, { once: true })
  }

  try {
    let proc = processPool.get(poolKey)

    if (!proc || !proc.isAlive()) {
      // Clean up dead process from pool
      if (proc) processPool.delete(poolKey)

      // Acquire a concurrency slot for the new persistent process.
      // This slot is held for the lifetime of the process (released in shutdownPersistentProcess),
      // NOT per-invoke like one-shot mode.
      await acquireSlot(signal)

      try {
        // Always create a new session — persistent mode maintains context in-process.
        // Resuming old sessions would load unbounded history, growing the context indefinitely.
        proc = new PersistentProcess({
          binary: persistentBinary,
          cwd,
          model,
          systemPrompt,
          skipPermissions,
          variant,
          // sessionId intentionally omitted — no --resume
        })
        proc.start()
        processPool.set(poolKey, proc)
        registerPoolExitListener(poolKey, proc)
        logger.info(`Started persistent process for key=${poolKey}`)

        // Wait for system_init before sending the first message to ensure the CLI is ready.
        await waitForReady(proc, poolKey, signal)
      } catch (startErr) {
        // Process failed to start or ready — cleanup to prevent orphan process
        processPool.delete(poolKey)
        releaseSlot()
        // Shutdown the already-started process (best-effort, don't block on failure)
        proc?.shutdown().catch(() => {})
        throw startErr
      }
    }

    // Collect response from events during this message round
    const result = await collectInvokeResult(proc, prompt, startTime, {
      onChunk,
      onToolUse,
      signal,
      cachedSessionId: sessionIdCache.get(poolKey),
    })

    return ok(result)
  } catch (error: unknown) {
    if (signal?.aborted) {
      return err({ type: 'cancelled', message: 'Chat interrupted by new message' })
    }
    const msg = getErrorMessage(error)
    logger.error(`Persistent invoke failed: ${msg}`)
    return err({ type: 'process', message: msg })
  } finally {
    // Clean up abort listener to prevent leak across invocations
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler)
    }
  }
}

// ============ Process Readiness ============

/** Wait for system_init event from the CLI, indicating it's ready to accept messages.
 *  Caches the sessionId from system_init since this event won't fire again for subsequent calls. */
function waitForReady(proc: PersistentProcess, poolKey: string, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onEvent = (event: PersistentProcessEvent) => {
      if (event.type === 'system_init') {
        cleanup()
        if (event.sessionId) sessionIdCache.set(poolKey, event.sessionId)
        resolve()
      } else if (event.type === 'error') {
        cleanup()
        reject(new Error(event.message))
      } else if (event.type === 'exit') {
        cleanup()
        reject(new Error(`Process exited before ready with code ${event.code}`))
      }
    }
    const onAbort = () => {
      cleanup()
      reject(new Error('Aborted'))
    }
    const cleanup = () => {
      proc.removeListener('event', onEvent)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    if (signal?.aborted) { reject(new Error('Aborted')); return }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    proc.on('event', onEvent)
  })
}

// ============ Response Collection ============

interface CollectOptions {
  onChunk?: (chunk: string) => void
  onToolUse?: () => void
  signal?: AbortSignal
  /** Cached sessionId from system_init (consumed by waitForReady, unavailable in subsequent calls) */
  cachedSessionId?: string
  /** Per-message timeout in ms. Defaults to DEFAULT_MESSAGE_TIMEOUT_MS (30min) */
  messageTimeoutMs?: number
}

async function collectInvokeResult(
  proc: PersistentProcess,
  prompt: string,
  startTime: number,
  opts: CollectOptions
): Promise<InvokeResult> {
  return new Promise<InvokeResult>((resolve, reject) => {
    let response = ''
    let resultSessionId = opts.cachedSessionId ?? ''
    let costUsd: number | undefined
    let durationApiMs: number | undefined
    let promptTokens: number | undefined
    let completionTokens: number | undefined
    let totalTokens: number | undefined
    let settled = false

    const timeoutMs = opts.messageTimeoutMs ?? DEFAULT_MESSAGE_TIMEOUT_MS
    const timeoutTimer = setTimeout(() => {
      if (!settled) {
        cleanup()
        // Shutdown the stuck process so next invoke creates a fresh one
        proc.shutdown().catch(() => {})
        reject(new Error(`Persistent invoke timed out after ${(timeoutMs / 1000).toFixed(0)}s — process shut down`))
      }
    }, timeoutMs)

    const cleanup = () => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      proc.removeListener('event', onEvent)
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort)
      }
    }

    const onAbort = () => {
      cleanup()
      reject(new Error('Aborted'))
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        clearTimeout(timeoutTimer)
        reject(new Error('Aborted'))
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    const onEvent = (event: PersistentProcessEvent) => {
      if (settled) return

      switch (event.type) {
        case 'text_delta':
          opts.onChunk?.(event.text)
          break

        case 'tool_use':
          opts.onToolUse?.()
          break

        case 'assistant':
          response = event.text
          break

        case 'system_init':
          resultSessionId = event.sessionId
          break

        case 'result': {
          if (!response) {
            logger.warn('Result received but no assistant text was captured — possible event loss')
          }
          resultSessionId = event.sessionId || resultSessionId
          costUsd = event.costUsd
          durationApiMs = event.durationApiMs
          promptTokens = event.metrics.promptTokens
          completionTokens = event.metrics.completionTokens
          totalTokens = event.metrics.totalTokens
          cleanup()

          const durationMs = Date.now() - startTime
          logger.info(
            `完成 (${(durationMs / 1000).toFixed(1)}s, API: ${((durationApiMs ?? 0) / 1000).toFixed(1)}s)`
          )

          resolve({
            prompt,
            response,
            durationMs,
            sessionId: resultSessionId,
            durationApiMs,
            costUsd,
            promptTokens,
            completionTokens,
            totalTokens,
          })
          break
        }

        case 'error':
          cleanup()
          reject(new Error(event.message))
          break

        case 'exit':
          cleanup()
          reject(new Error(`Process exited unexpectedly with code ${event.code}`))
          break
      }
    }

    proc.on('event', onEvent)

    // Send user prompt (system_init already received if first call — see waitForReady)
    proc.sendMessage(prompt).catch((sendErr) => {
      if (!settled) {
        cleanup()
        reject(sendErr)
      }
    })
  })
}

// ============ Lifecycle Management ============

/**
 * Shutdown the persistent process for a given task.
 * Called from executeTask finally block.
 *
 * Note: This uses taskId as pool key, which matches getPoolKey() only when
 * traceCtx.taskId is provided. Non-task callers (keyed by cwd) must be
 * cleaned up via shutdownAllPersistentProcesses or process exit listener.
 */
export async function shutdownPersistentProcess(taskId: string): Promise<void> {
  const proc = processPool.get(taskId)
  if (!proc) return

  processPool.delete(taskId)
  sessionIdCache.delete(taskId)
  try {
    await proc.shutdown()
    logger.info(`Shutdown persistent process for task=${taskId}`)
  } catch (error) {
    logger.warn(`Error shutting down persistent process: ${getErrorMessage(error)}`)
  } finally {
    // Release the concurrency slot held since process start
    releaseSlot()
  }
}

/** Check if a persistent process is alive for the given pool key (taskId or cwd) */
export function isPersistentProcessAlive(poolKey: string): boolean {
  const proc = processPool.get(poolKey)
  return !!proc && proc.isAlive()
}

/** Get active persistent process count (for diagnostics) */
export function getPersistentProcessCount(): number {
  return processPool.size
}

/**
 * Shutdown all persistent processes in the pool.
 * Called during graceful daemon shutdown to prevent zombie child processes.
 */
export async function shutdownAllPersistentProcesses(): Promise<void> {
  const entries = [...processPool.entries()]
  if (entries.length === 0) return

  logger.info(`Shutting down ${entries.length} persistent process(es)`)
  processPool.clear()
  sessionIdCache.clear()

  await Promise.allSettled(
    entries.map(async ([key, proc]) => {
      try {
        await proc.shutdown()
        logger.info(`Shutdown persistent process: key=${key}`)
      } catch (error) {
        logger.warn(`Error shutting down persistent process key=${key}: ${getErrorMessage(error)}`)
      } finally {
        // Release the concurrency slot held by this process
        releaseSlot()
      }
    })
  )
}
