/**
 * Append lifecycle events to ~/.cah-data/lifecycle.jsonl
 *
 * Used by startDaemon to record daemon start/stop events.
 * Read by collectLifecycleStats for uptime metrics.
 */

import { appendFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { DATA_DIR } from '../store/paths.js'
import { createRequire } from 'module'

const LIFECYCLE_LOG_PATH = join(DATA_DIR, 'lifecycle.jsonl')

interface LifecycleStartEvent {
  type: 'start'
  pid: number
}

interface LifecycleStopEvent {
  type: 'stop'
  pid: number
  uptimeMs: number
}

type LifecycleEventInput = LifecycleStartEvent | LifecycleStopEvent

function getVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('../../package.json')
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Append a lifecycle event to lifecycle.jsonl */
export function appendLifecycleEvent(event: LifecycleEventInput): void {
  try {
    mkdirSync(dirname(LIFECYCLE_LOG_PATH), { recursive: true })
    const record = {
      ...event,
      timestamp: new Date().toISOString(),
      ...(event.type === 'start' ? { version: getVersion() } : {}),
    }
    appendFileSync(LIFECYCLE_LOG_PATH, JSON.stringify(record) + '\n')
  } catch {
    // Best-effort — don't crash daemon for logging failures
  }
}
