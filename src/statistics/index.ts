/**
 * @entry Statistics 统计模块
 *
 * 提供系统运行统计数据的收集和缓存
 *
 * 主要 API:
 * - getStatsOverview(force?): 获取完整统计概览（含 5 分钟缓存）
 * - readStatsCache / writeStatsCache: 缓存读写
 */

export { readStatsCache, writeStatsCache } from './statsCache.js'
export type {
  StatsOverview,
  ChatStats,
  TaskStats,
  LifecycleStats,
  GrowthStats,
  GrowthMilestone,
  StatsCache,
  HourDistribution,
  WeekdayDistribution,
  ChannelStats,
  WeeklySuccessRate,
} from './types.js'

import { collectChatStats } from './collectChatStats.js'
import { collectTaskStats } from './collectTaskStats.js'
import { collectLifecycleStats } from './collectLifecycleStats.js'
import { collectGrowthStats } from './collectGrowthStats.js'
import { readStatsCache, writeStatsCache } from './statsCache.js'
import { createLogger } from '../shared/logger.js'
import type { StatsOverview } from './types.js'

const logger = createLogger('statistics')

/**
 * @entry Get full statistics overview.
 * Returns cached data if available and fresh (< 5 min), otherwise recomputes.
 * Pass force=true to bypass cache.
 */
export function getStatsOverview(force = false): StatsOverview {
  if (!force) {
    const cached = readStatsCache()
    if (cached) {
      logger.debug('Returning cached stats')
      return cached
    }
  }

  logger.debug('Computing fresh stats...')

  const overview: StatsOverview = {
    chat: collectChatStats(),
    task: collectTaskStats(),
    lifecycle: collectLifecycleStats(),
    growth: collectGrowthStats(),
    generatedAt: new Date().toISOString(),
  }

  writeStatsCache(overview)
  return overview
}
