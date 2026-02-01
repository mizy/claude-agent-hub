/**
 * 执行时间预估器
 * 基于历史执行数据预估剩余时间
 */

import { join } from 'path'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { TASKS_DIR } from '../store/paths.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('time-estimator')

/**
 * 节点执行时间记录
 */
interface NodeTimeRecord {
  nodeName: string
  nodeType: string
  durationMs: number
  costUsd: number
}

/**
 * 历史执行数据缓存
 */
interface HistoricalData {
  nodeAverages: Map<string, { avgDurationMs: number; samples: number }>
  typeAverages: Map<string, { avgDurationMs: number; samples: number }>
  globalAvgDurationMs: number
  totalSamples: number
}

let cachedData: HistoricalData | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60000 // 缓存 1 分钟

/**
 * 加载历史执行数据
 */
function loadHistoricalData(): HistoricalData {
  const now = Date.now()
  if (cachedData && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedData
  }

  const nodeAverages = new Map<string, { avgDurationMs: number; samples: number }>()
  const typeAverages = new Map<string, { avgDurationMs: number; samples: number }>()
  let totalDuration = 0
  let totalSamples = 0

  if (!existsSync(TASKS_DIR)) {
    cachedData = { nodeAverages, typeAverages, globalAvgDurationMs: 120000, totalSamples: 0 }
    cacheTimestamp = now
    return cachedData
  }

  const taskDirs = readdirSync(TASKS_DIR).filter(d => d.startsWith('task-'))

  for (const taskDir of taskDirs) {
    const statsPath = join(TASKS_DIR, taskDir, 'stats.json')
    if (!existsSync(statsPath)) continue

    try {
      const stats = JSON.parse(readFileSync(statsPath, 'utf-8'))
      const nodes = stats.nodes as NodeTimeRecord[] | undefined
      if (!nodes) continue

      for (const node of nodes) {
        if (!node.durationMs || node.durationMs <= 0) continue

        // 按节点名称统计
        const existing = nodeAverages.get(node.nodeName)
        if (existing) {
          existing.avgDurationMs =
            (existing.avgDurationMs * existing.samples + node.durationMs) / (existing.samples + 1)
          existing.samples++
        } else {
          nodeAverages.set(node.nodeName, { avgDurationMs: node.durationMs, samples: 1 })
        }

        // 按节点类型统计
        const typeKey = node.nodeType || 'task'
        const typeExisting = typeAverages.get(typeKey)
        if (typeExisting) {
          typeExisting.avgDurationMs =
            (typeExisting.avgDurationMs * typeExisting.samples + node.durationMs) / (typeExisting.samples + 1)
          typeExisting.samples++
        } else {
          typeAverages.set(typeKey, { avgDurationMs: node.durationMs, samples: 1 })
        }

        totalDuration += node.durationMs
        totalSamples++
      }
    } catch {
      // ignore invalid stats files
    }
  }

  const globalAvgDurationMs = totalSamples > 0 ? totalDuration / totalSamples : 120000 // 默认 2 分钟

  cachedData = { nodeAverages, typeAverages, globalAvgDurationMs, totalSamples }
  cacheTimestamp = now

  logger.debug(`Loaded historical data: ${totalSamples} samples, avg ${Math.round(globalAvgDurationMs / 1000)}s per node`)

  return cachedData
}

/**
 * 预估单个节点的执行时间
 */
export function estimateNodeDuration(nodeName: string, nodeType: string = 'task'): number {
  const data = loadHistoricalData()

  // 优先使用同名节点的历史数据
  const nameMatch = data.nodeAverages.get(nodeName)
  if (nameMatch && nameMatch.samples >= 2) {
    return nameMatch.avgDurationMs
  }

  // 其次使用同类型节点的历史数据
  const typeMatch = data.typeAverages.get(nodeType)
  if (typeMatch && typeMatch.samples >= 3) {
    return typeMatch.avgDurationMs
  }

  // 最后使用全局平均值
  return data.globalAvgDurationMs
}

/**
 * 预估剩余时间
 */
export interface TimeEstimate {
  /** 预估剩余时间（毫秒） */
  remainingMs: number
  /** 预估总时间（毫秒） */
  totalMs: number
  /** 已消耗时间（毫秒） */
  elapsedMs: number
  /** 置信度 (0-1) */
  confidence: number
  /** 格式化的剩余时间字符串 */
  remainingFormatted: string
}

/**
 * 节点状态
 */
interface NodeState {
  name: string
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  durationMs?: number
  startedAt?: string
}

/**
 * 预估工作流剩余时间
 */
export function estimateRemainingTime(
  nodes: NodeState[],
  elapsedMs: number
): TimeEstimate {
  const data = loadHistoricalData()

  let completedCount = 0
  let pendingEstimate = 0
  let runningEstimate = 0

  for (const node of nodes) {
    if (node.status === 'completed') {
      if (node.durationMs) {
        completedCount++
      }
    } else if (node.status === 'running') {
      // 运行中的节点：预估剩余时间
      const estimated = estimateNodeDuration(node.name, node.type)
      if (node.startedAt) {
        const runningTime = Date.now() - new Date(node.startedAt).getTime()
        // 预估剩余 = 预估总时间 - 已运行时间（至少 10 秒）
        runningEstimate += Math.max(estimated - runningTime, 10000)
      } else {
        runningEstimate += estimated / 2 // 假设运行了一半
      }
    } else if (node.status === 'pending') {
      pendingEstimate += estimateNodeDuration(node.name, node.type)
    }
    // skipped 和 failed 节点不计入
  }

  const remainingMs = Math.max(runningEstimate + pendingEstimate, 0)
  const totalMs = elapsedMs + remainingMs

  // 计算置信度：样本越多越准确，已完成节点越多越准确
  const sampleConfidence = Math.min(data.totalSamples / 20, 1) // 20 个样本达到满分
  const progressConfidence = completedCount > 0 ? Math.min(completedCount / nodes.length + 0.3, 1) : 0.3
  const confidence = (sampleConfidence + progressConfidence) / 2

  return {
    remainingMs,
    totalMs,
    elapsedMs,
    confidence,
    remainingFormatted: formatDuration(remainingMs),
  }
}

/**
 * 格式化时间
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '即将完成'
  if (ms < 1000) return '<1s'
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.round((ms % 60000) / 1000)
    return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`
  }
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.round((ms % 3600000) / 60000)
  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`
}

/**
 * 格式化时间预估为字符串
 */
export function formatTimeEstimate(estimate: TimeEstimate): string {
  const confidenceStr = estimate.confidence >= 0.7 ? '' : estimate.confidence >= 0.4 ? '~' : '≈'
  return `${confidenceStr}${estimate.remainingFormatted}`
}

/**
 * 清除缓存（用于测试）
 */
export function clearCache(): void {
  cachedData = null
  cacheTimestamp = 0
}
