/**
 * Self Model — 自我认知模型的读写
 *
 * SelfModel 记录 Agent 对自身能力、偏好、状态的认知
 * ReflectionEntry 记录每日/周期性自我反思日志
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { SELF_MODEL_PATH, REFLECTIONS_LOG_PATH } from '../store/paths.js'
import { getErrorMessage } from '../shared/assertError.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('selfModel')

// ============ Types ============

export interface SelfModel {
  updatedAt: string
  strengths: string[]
  weaknesses: string[]
  userPreferences: Record<string, string>
  recentInsights: string[]
  state: {
    engagement: number // 0-1
    idleness: number // 0-1, higher = longer since last interaction
    fatigue: number // 0-1
  }
  narrative: string
  narrativeUpdatedAt: string
}

export interface ReflectionEntry {
  date: string
  reflection: string
  patterns: string[]
  focus: string
  state: {
    engagement: number
    idleness: number
    fatigue: number
  }
}

// ============ Self Model IO ============

export function createDefaultSelfModel(): SelfModel {
  const now = new Date().toISOString()
  return {
    updatedAt: now,
    strengths: [],
    weaknesses: [],
    userPreferences: {},
    recentInsights: [],
    state: {
      engagement: 0.5,
      idleness: 0.5,
      fatigue: 0.5,
    },
    narrative: '',
    narrativeUpdatedAt: now,
  }
}

export function loadSelfModel(): SelfModel {
  try {
    const raw = readFileSync(SELF_MODEL_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    const defaults = createDefaultSelfModel()
    return {
      ...defaults,
      ...parsed,
      state: { ...defaults.state, ...parsed.state },
    }
  } catch {
    return createDefaultSelfModel()
  }
}

export function saveSelfModel(model: SelfModel): void {
  try {
    mkdirSync(dirname(SELF_MODEL_PATH), { recursive: true })
    writeFileSync(SELF_MODEL_PATH, JSON.stringify(model, null, 2), 'utf-8')
  } catch (error) {
    logger.warn(`Failed to save self model: ${getErrorMessage(error)}`)
  }
}

// ============ Consciousness Log IO ============

export function appendConsciousnessLog(entry: ReflectionEntry): void {
  try {
    mkdirSync(dirname(REFLECTIONS_LOG_PATH), { recursive: true })
    appendFileSync(REFLECTIONS_LOG_PATH, JSON.stringify(entry) + '\n', 'utf-8')
  } catch (error) {
    logger.warn(`Failed to append consciousness log: ${getErrorMessage(error)}`)
  }
}

export function readConsciousnessLogs(days: number): ReflectionEntry[] {
  try {
    const raw = readFileSync(REFLECTIONS_LOG_PATH, 'utf-8')
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const entries: ReflectionEntry[] = []
    for (const line of raw.trim().split('\n')) {
      if (!line) continue
      try {
        const entry = JSON.parse(line) as ReflectionEntry
        if (entry.date?.slice(0, 10) >= cutoffStr) {
          entries.push(entry)
        }
      } catch {
        // skip malformed
      }
    }
    return entries
  } catch {
    return []
  }
}
