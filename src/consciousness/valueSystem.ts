/**
 * Value preference learning system
 *
 * Learns user value preferences from task feedback (approve/reject/request).
 * Weights evolve over time based on accumulated evidence.
 *
 * Storage: ~/.cah-data/consciousness/value-system.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { VALUE_SYSTEM_PATH } from '../store/paths.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('consciousness:values')


const MIN_WEIGHT = 0.1
const MAX_WEIGHT = 1.0
const MAX_EVIDENCE_PER_DIMENSION = 20
const DECAY_DAYS = 30
const DECAY_FACTOR = 0.95

export interface Evidence {
  type: 'approve' | 'reject' | 'request' | 'feedback'
  description: string
  timestamp: string
  impact: number
}

export interface ValueDimension {
  dimension: string
  weight: number
  evidence: Evidence[]
  lastUpdated: string
}

export interface ValueSystem {
  dimensions: ValueDimension[]
  updatedAt: string
}

const DEFAULT_DIMENSIONS = [
  'code_quality',
  'ux_polish',
  'new_features',
  'performance',
  'stability',
  'autonomy',
]

function createDefaultSystem(): ValueSystem {
  const now = new Date().toISOString()
  return {
    dimensions: DEFAULT_DIMENSIONS.map(d => ({
      dimension: d,
      weight: 0.5,
      evidence: [],
      lastUpdated: now,
    })),
    updatedAt: now,
  }
}

function ensureDir(): void {
  mkdirSync(dirname(VALUE_SYSTEM_PATH), { recursive: true })
}

function readSystem(): ValueSystem {
  try {
    const raw = readFileSync(VALUE_SYSTEM_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.dimensions)) return parsed as ValueSystem
    return createDefaultSystem()
  } catch {
    return createDefaultSystem()
  }
}

function writeSystem(system: ValueSystem): void {
  try {
    ensureDir()
    system.updatedAt = new Date().toISOString()
    writeFileSync(VALUE_SYSTEM_PATH, JSON.stringify(system, null, 2), 'utf-8')
  } catch (error) {
    logger.warn(`Failed to write value system: ${getErrorMessage(error)}`)
  }
}

function clampWeight(w: number): number {
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, w))
}

function applyDecay(system: ValueSystem): boolean {
  const now = Date.now()
  const threshold = DECAY_DAYS * 24 * 60 * 60 * 1000
  let changed = false

  for (const dim of system.dimensions) {
    const lastUpdate = new Date(dim.lastUpdated).getTime()
    if (now - lastUpdate > threshold) {
      dim.weight = clampWeight(dim.weight * DECAY_FACTOR)
      dim.lastUpdated = new Date().toISOString()
      changed = true
    }
  }
  return changed
}

function trimEvidence(evidence: Evidence[]): Evidence[] {
  if (evidence.length <= MAX_EVIDENCE_PER_DIMENSION) return evidence
  // Keep most recent
  return evidence
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, MAX_EVIDENCE_PER_DIMENSION)
}

function findOrCreateDimension(system: ValueSystem, dimension: string): ValueDimension {
  let dim = system.dimensions.find(d => d.dimension === dimension)
  if (!dim) {
    dim = { dimension, weight: 0.5, evidence: [], lastUpdated: new Date().toISOString() }
    system.dimensions.push(dim)
  }
  return dim
}

/** Load value system with automatic decay applied */
export function loadValueSystem(): ValueSystem {
  const system = readSystem()
  if (applyDecay(system)) {
    writeSystem(system)
  }
  return system
}

/** Reinforce a value dimension (increase weight + record evidence) */
export function reinforceValue(dimension: string, evidence: Evidence): void {
  const system = readSystem()
  const dim = findOrCreateDimension(system, dimension)
  dim.weight = clampWeight(dim.weight + evidence.impact * 0.1)
  dim.evidence.push(evidence)
  dim.evidence = trimEvidence(dim.evidence)
  dim.lastUpdated = new Date().toISOString()
  writeSystem(system)
}

/** Weaken a value dimension (decrease weight + record evidence) */
export function weakenValue(dimension: string, evidence: Evidence): void {
  const system = readSystem()
  const dim = findOrCreateDimension(system, dimension)
  dim.weight = clampWeight(dim.weight - evidence.impact * 0.1)
  dim.evidence.push(evidence)
  dim.evidence = trimEvidence(dim.evidence)
  dim.lastUpdated = new Date().toISOString()
  writeSystem(system)
}

/**
 * Opposing dimension pairs — when both are high, they compete for attention.
 * The stronger one suppresses the weaker slightly, simulating resource contention.
 */
const OPPOSING_PAIRS: Array<[string, string]> = [
  ['stability', 'new_features'],     // 稳定 vs 冒险
  ['code_quality', 'performance'],   // 质量 vs 速度
  ['autonomy', 'ux_polish'],         // 自主进化 vs 用户体验
]

/** Suppress factor when opponent weight is high (0-1 scale) */
const OPPOSITION_STRENGTH = 0.15

/**
 * Apply opposition suppression: when two opposing dimensions are both high,
 * the weaker one gets slightly suppressed. This prevents the system from
 * wanting everything at once and forces meaningful trade-offs.
 */
function applyOpposition(dims: Array<{ dimension: string; weight: number }>): Array<{ dimension: string; weight: number }> {
  const weightMap = new Map(dims.map(d => [d.dimension, d.weight]))

  for (const [a, b] of OPPOSING_PAIRS) {
    const wa = weightMap.get(a) ?? 0.5
    const wb = weightMap.get(b) ?? 0.5
    // Only suppress when both are above 0.5 (both "active")
    if (wa > 0.5 && wb > 0.5) {
      const diff = wa - wb
      if (diff > 0) {
        // a is stronger, suppress b
        weightMap.set(b, Math.max(MIN_WEIGHT, wb - Math.abs(diff) * OPPOSITION_STRENGTH))
      } else if (diff < 0) {
        // b is stronger, suppress a
        weightMap.set(a, Math.max(MIN_WEIGHT, wa - Math.abs(diff) * OPPOSITION_STRENGTH))
      }
      // If equal, no suppression — true equilibrium
    }
  }

  return dims.map(d => ({ dimension: d.dimension, weight: Math.round((weightMap.get(d.dimension) ?? d.weight) * 100) / 100 }))
}

/** Get all dimension weights (sorted by weight descending, with opposition applied) */
export function getValueWeights(): Array<{ dimension: string; weight: number }> {
  const system = loadValueSystem()
  const raw = system.dimensions.map(d => ({ dimension: d.dimension, weight: d.weight }))
  return applyOpposition(raw).sort((a, b) => b.weight - a.weight)
}

/** Get top N value dimensions by weight */
export function getTopValues(n = 3): Array<{ dimension: string; weight: number }> {
  return getValueWeights().slice(0, n)
}

/** Format value preferences for prompt injection */
export function formatValuePreferences(values: Array<{ dimension: string; weight: number }>): string {
  if (values.length === 0) return ''
  const labels: Record<string, string> = {
    code_quality: '代码质量',
    ux_polish: '用户体验',
    new_features: '新功能',
    performance: '性能',
    stability: '稳定性',
    autonomy: '自主性',
  }
  const lines = values.map((v, i) =>
    `${i + 1}. ${labels[v.dimension] ?? v.dimension}(${v.weight.toFixed(2)})`
  )
  return `[价值偏好（从历史反馈学习）]\n${lines.join('\n')}`
}
