/**
 * Statistics cache layer
 *
 * Caches computed stats in ~/.cah-data/stats-cache.json with 5-minute TTL.
 * Avoids expensive re-computation on every request.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { DATA_DIR } from '../store/paths.js'
import { getErrorMessage } from '../shared/assertError.js'
import { createLogger } from '../shared/logger.js'
import type { StatsOverview, StatsCache } from './types.js'

const logger = createLogger('stats-cache')
const CACHE_PATH = join(DATA_DIR, 'stats-cache.json')
const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** Read cached stats if still valid */
export function readStatsCache(): StatsOverview | null {
  try {
    if (!existsSync(CACHE_PATH)) return null
    const raw = readFileSync(CACHE_PATH, 'utf-8')
    const cache = JSON.parse(raw) as StatsCache
    if (!cache.data || !cache.cachedAt || !cache.ttlMs) return null
    const age = Date.now() - cache.cachedAt
    if (age > cache.ttlMs) {
      logger.debug('Stats cache expired')
      return null
    }
    return cache.data
  } catch (error) {
    logger.debug(`Failed to read stats cache: ${getErrorMessage(error)}`)
    return null
  }
}

/** Write stats to cache */
export function writeStatsCache(data: StatsOverview, ttlMs = DEFAULT_TTL_MS): void {
  try {
    const dir = dirname(CACHE_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const cache: StatsCache = {
      data,
      cachedAt: Date.now(),
      ttlMs,
    }
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8')
  } catch (error) {
    logger.debug(`Failed to write stats cache: ${getErrorMessage(error)}`)
  }
}

/** Invalidate the cache */
export function invalidateStatsCache(): void {
  try {
    if (existsSync(CACHE_PATH)) {
      unlinkSync(CACHE_PATH)
    }
  } catch {
    // ignore
  }
}
