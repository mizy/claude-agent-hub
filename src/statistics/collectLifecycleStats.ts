/**
 * Collect daemon lifecycle statistics from lifecycle.jsonl
 *
 * Reads the append-only lifecycle log and computes uptime metrics.
 * File format: one JSON per line with { type, timestamp, pid, version }
 */

import { readFileSync } from 'fs'
import { LIFECYCLE_LOG_FILE_PATH } from '../store/paths.js'
import { getErrorMessage } from '../shared/assertError.js'
import { createLogger } from '../shared/logger.js'
import type { LifecycleStats } from './types.js'

const logger = createLogger('stats-lifecycle')
const LIFECYCLE_LOG_PATH = LIFECYCLE_LOG_FILE_PATH

interface LifecycleEvent {
  type: 'start' | 'stop'
  timestamp: string
  pid: number
  version?: string
}

/** Parse lifecycle.jsonl entries */
function parseLifecycleEvents(): LifecycleEvent[] {
  try {
    const content = readFileSync(LIFECYCLE_LOG_PATH, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const events: LifecycleEvent[] = []
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as LifecycleEvent)
      } catch {
        // skip malformed
      }
    }
    return events
  } catch (error) {
    logger.debug(`Failed to read lifecycle log: ${getErrorMessage(error)}`)
    return []
  }
}

/** Check if a PID is currently running */
function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** @entry Collect daemon lifecycle statistics */
export function collectLifecycleStats(): LifecycleStats {
  const events = parseLifecycleEvents()

  if (events.length === 0) {
    return {
      startCount: 0,
      totalUptimeMs: 0,
      longestUptimeMs: 0,
      currentUptimeMs: 0,
      isRunning: false,
      versionHistory: [],
    }
  }

  let startCount = 0
  let totalUptimeMs = 0
  let longestUptimeMs = 0
  let currentUptimeMs = 0
  let isRunning = false
  let lastStartedAt: string | undefined
  const versionHistory: { version: string; timestamp: string }[] = []
  const seenVersions = new Set<string>()

  // Track start events to pair with stops
  let pendingStart: { timestamp: string; pid: number } | null = null

  for (const evt of events) {
    if (evt.type === 'start') {
      // Close any unclosed previous start session
      if (pendingStart) {
        const uptimeMs = new Date(evt.timestamp).getTime() - new Date(pendingStart.timestamp).getTime()
        if (uptimeMs > 0) {
          totalUptimeMs += uptimeMs
          if (uptimeMs > longestUptimeMs) longestUptimeMs = uptimeMs
        }
      }
      startCount++
      pendingStart = { timestamp: evt.timestamp, pid: evt.pid }
      lastStartedAt = evt.timestamp

      if (evt.version && !seenVersions.has(evt.version)) {
        seenVersions.add(evt.version)
        versionHistory.push({ version: evt.version, timestamp: evt.timestamp })
      }
    } else if (evt.type === 'stop' && pendingStart) {
      const uptimeMs = new Date(evt.timestamp).getTime() - new Date(pendingStart.timestamp).getTime()
      if (uptimeMs > 0) {
        totalUptimeMs += uptimeMs
        if (uptimeMs > longestUptimeMs) longestUptimeMs = uptimeMs
      }
      pendingStart = null
    }
  }

  // If there's an unclosed start, check if daemon is still running
  if (pendingStart) {
    isRunning = isPidRunning(pendingStart.pid)
    if (isRunning) {
      currentUptimeMs = Date.now() - new Date(pendingStart.timestamp).getTime()
      totalUptimeMs += currentUptimeMs
      if (currentUptimeMs > longestUptimeMs) longestUptimeMs = currentUptimeMs
    }
  }

  return {
    startCount,
    totalUptimeMs,
    longestUptimeMs,
    currentUptimeMs,
    isRunning,
    lastStartedAt,
    versionHistory,
  }
}
