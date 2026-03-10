/**
 * Compute task metrics for evolution effect tracking.
 *
 * Calculates success rate and average duration for tasks within a date range,
 * used by growth journal to measure before/after evolution impact.
 */

import { getAllTasks } from '../store/TaskStore.js'
import type { Task } from '../types/task.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('consciousness:evolution-metrics')

// In-memory cache: timestamps rounded to 5-min buckets for effective cache hits
const metricsCache = new Map<string, { result: EvolutionMetrics | null; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_BUCKET_MS = 5 * 60 * 1000 // round timestamps to 5-min granularity
const MAX_CACHE_ENTRIES = 20

export interface EvolutionMetrics {
  successRate: number      // 0-1, completed / (completed + failed)
  avgDurationMs: number    // average task duration in ms
  totalTasks: number       // total tasks in period (completed + failed)
  period: { from: string; to: string }
}

/**
 * Compute task metrics for a given time range.
 * Only counts terminal tasks (completed/failed) — ignores pending/developing.
 */
export function computeTaskMetrics(fromDate: Date, toDate: Date): EvolutionMetrics | null {
  try {
    // Round timestamps to 5-min buckets so near-identical calls share cache
    const fromBucket = Math.floor(fromDate.getTime() / CACHE_BUCKET_MS) * CACHE_BUCKET_MS
    const toBucket = Math.floor(toDate.getTime() / CACHE_BUCKET_MS) * CACHE_BUCKET_MS
    const cacheKey = `${fromBucket}-${toBucket}`
    const cached = metricsCache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) return cached.result

    const allTasks = getAllTasks()
    const fromTs = fromDate.getTime()
    const toTs = toDate.getTime()

    const tasksInRange = allTasks.filter((t: Task) => {
      // Prefer output.timing.completedAt for accurate completion time, fallback to createdAt
      const timeRef = t.output?.timing?.completedAt ?? t.createdAt
      const ts = new Date(timeRef).getTime()
      if (isNaN(ts)) return false
      return ts >= fromTs && ts <= toTs && (t.status === 'completed' || t.status === 'failed')
    })

    if (tasksInRange.length === 0) {
      if (metricsCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = metricsCache.keys().next().value
        if (firstKey) metricsCache.delete(firstKey)
      }
      metricsCache.set(cacheKey, { result: null, expiresAt: Date.now() + CACHE_TTL_MS })
      return null
    }

    const completed = tasksInRange.filter(t => t.status === 'completed')

    // Calculate average duration from tasks that have output timing
    let totalDuration = 0
    let durationCount = 0
    for (const t of completed) {
      if (t.output?.timing?.startedAt && t.output?.timing?.completedAt) {
        const dur = new Date(t.output.timing.completedAt).getTime() -
                    new Date(t.output.timing.startedAt).getTime()
        if (dur > 0) {
          totalDuration += dur
          durationCount++
        }
      }
    }

    const result: EvolutionMetrics = {
      successRate: completed.length / tasksInRange.length,
      avgDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
      totalTasks: tasksInRange.length,
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    }
    // Evict oldest entries if cache grows too large
    if (metricsCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = metricsCache.keys().next().value
      if (firstKey) metricsCache.delete(firstKey)
    }
    metricsCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS })
    return result
  } catch (e) {
    logger.warn(`Failed to compute task metrics: ${e}`)
    return null
  }
}
