/**
 * Queue file lock and data access
 * Shared infrastructure for queue operations
 */

import { existsSync, unlinkSync, writeFileSync, statSync } from 'fs'
import { readJson, writeJson, ensureDir } from '../../store/readWriteJson.js'
import { QUEUE_FILE, DATA_DIR } from '../../store/paths.js'
import type { NodeJobData } from '../types.js'

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

function acquireLock(): boolean {
  if (lockAcquired) return true

  try {
    if (existsSync(LOCK_FILE)) {
      const stat = statSync(LOCK_FILE)
      const age = Date.now() - stat.mtimeMs
      if (age < LOCK_TIMEOUT_MS) {
        return false
      }
      unlinkSync(LOCK_FILE)
    }

    writeFileSync(LOCK_FILE, process.pid.toString(), { flag: 'wx' })
    lockAcquired = true
    return true
  } catch {
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
  } catch {
    // ignore
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
  return (
    readJson<QueueData>(QUEUE_FILE, {
      defaultValue: { jobs: [], updatedAt: new Date().toISOString() },
    }) ?? { jobs: [], updatedAt: new Date().toISOString() }
  )
}

export function saveQueueData(data: QueueData): void {
  data.updatedAt = new Date().toISOString()
  writeJson(QUEUE_FILE, data)
}
