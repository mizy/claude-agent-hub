/**
 * Queue file lock and data access
 * Shared infrastructure for queue operations
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync, statSync } from 'fs'
import { readJson, writeJson, ensureDir } from '../../store/readWriteJson.js'
import { QUEUE_FILE, DATA_DIR } from '../../store/paths.js'
import type { NodeJobData } from '../types.js'
import { createLogger } from '../../shared/logger.js'

const logger = createLogger('queue-lock')

const LOCK_TIMEOUT_MS = 30_000
const LOCK_RETRY_COUNT = 10
const LOCK_RETRY_DELAY_MS = 100

export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'human_waiting'

export interface Job {
  id: string
  name: string
  data: NodeJobData
  status: JobStatus
  priority: number
  delay: number
  attempts: number
  maxAttempts: number
  createdAt: string
  processAt: string
  completedAt?: string
  error?: string
}

export interface QueueData {
  jobs: Job[]
  updatedAt: string
}

// Simple file-based lock
const LOCK_FILE = `${QUEUE_FILE}.lock`
let lockAcquired = false

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function acquireLock(): boolean {
  if (lockAcquired) return true

  try {
    if (existsSync(LOCK_FILE)) {
      const stat = statSync(LOCK_FILE)
      const age = Date.now() - stat.mtimeMs

      // Check if holding process is still alive
      let holderAlive = true
      try {
        const holderPid = parseInt(readFileSync(LOCK_FILE, 'utf-8').trim(), 10)
        if (!Number.isNaN(holderPid)) {
          holderAlive = isProcessAlive(holderPid)
        }
      } catch {
        // Can't read lock file — treat as stale
        holderAlive = false
      }

      // Remove stale lock: holder is dead, or age exceeds timeout
      if (!holderAlive || age >= LOCK_TIMEOUT_MS) {
        logger.debug(`Removing stale queue lock (age=${Math.round(age / 1000)}s, holderAlive=${holderAlive})`)
        try {
          unlinkSync(LOCK_FILE)
        } catch {
          logger.debug('Stale lock already removed by another process')
        }
      } else {
        return false
      }
    }

    writeFileSync(LOCK_FILE, process.pid.toString(), { flag: 'wx' })
    lockAcquired = true
    return true
  } catch (e) {
    // EEXIST is normal contention — another process grabbed the lock between our check and create
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      logger.debug('Queue lock contention (EEXIST), will retry')
    } else {
      logger.error('Failed to acquire queue lock:', e)
    }
    return false
  }
}

export function releaseLock(): void {
  if (!lockAcquired) return

  try {
    if (existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE)
    }
    lockAcquired = false
  } catch (e) {
    logger.error('Failed to release queue lock:', e)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function withLockAsync<T>(fn: () => T | Promise<T>): Promise<T> {
  for (let i = 0; i < LOCK_RETRY_COUNT; i++) {
    if (acquireLock()) {
      try {
        return await fn()
      } finally {
        releaseLock()
      }
    }
    await sleep(LOCK_RETRY_DELAY_MS)
  }

  throw new Error('Failed to acquire queue lock')
}

export function withLock<T>(fn: () => T): T {
  for (let i = 0; i < LOCK_RETRY_COUNT; i++) {
    if (acquireLock()) {
      try {
        return fn()
      } finally {
        releaseLock()
      }
    }
    // Sync wait using Atomics to avoid CPU spin
    const buf = new SharedArrayBuffer(4)
    const arr = new Int32Array(buf)
    Atomics.wait(arr, 0, 0, LOCK_RETRY_DELAY_MS)
  }

  throw new Error('Failed to acquire queue lock')
}

export function getQueueData(): QueueData {
  ensureDir(DATA_DIR)
  const fallback: QueueData = { jobs: [], updatedAt: new Date().toISOString() }
  const raw = readJson<QueueData>(QUEUE_FILE, { defaultValue: fallback }) ?? fallback
  // Guard against malformed data (e.g. queue.json contains [] instead of {jobs:[]})
  if (!Array.isArray(raw.jobs)) {
    return fallback
  }
  return raw
}

export function saveQueueData(data: QueueData): void {
  data.updatedAt = new Date().toISOString()
  writeJson(QUEUE_FILE, data)
}
