/**
 * Data loaders for stats growth command — loads evolution history and value weights.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../../store/paths.js'

/** Evolution record summary (subset of evo-*.json) */
export interface EvolutionSummary {
  id: string
  status: string
  startedAt: string
  trigger: string
  improvements: { description: string }[]
  beforeMetrics?: Record<string, unknown>
  afterMetrics?: Record<string, unknown>
  performanceAnalysis?: { summary?: string }
}

/** Value dimension weight */
export interface ValueWeight {
  dimension: string
  weight: number
}

export function loadRecentEvolutions(limit: number): EvolutionSummary[] {
  try {
    const evoDir = join(DATA_DIR, 'evolution')
    let files: string[]
    try {
      files = readdirSync(evoDir).filter(f => f.startsWith('evo-') && f.endsWith('.json'))
    } catch {
      return []
    }

    const results: EvolutionSummary[] = []
    for (const f of files) {
      try {
        const raw = readFileSync(join(evoDir, f), 'utf-8')
        const data = JSON.parse(raw)
        results.push({
          id: data.id ?? f,
          status: data.status ?? 'unknown',
          startedAt: data.startedAt ?? '',
          trigger: data.trigger ?? 'unknown',
          improvements: Array.isArray(data.improvements) ? data.improvements : [],
          beforeMetrics: data.beforeMetrics,
          afterMetrics: data.afterMetrics,
          performanceAnalysis: data.performanceAnalysis,
        })
      } catch {
        // skip malformed
      }
    }

    // Sort by startedAt descending, take latest
    results.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    return results.slice(0, limit)
  } catch {
    return []
  }
}

export async function loadValueWeights(): Promise<ValueWeight[]> {
  try {
    const { loadValueSystem } = await import('../../consciousness/valueSystem.js')
    const system = loadValueSystem()
    return system.dimensions
      .map(d => ({ dimension: d.dimension, weight: d.weight }))
      .sort((a, b) => b.weight - a.weight)
  } catch {
    return []
  }
}
