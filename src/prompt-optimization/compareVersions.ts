/**
 * Compare two prompt versions by their performance stats.
 *
 * Provides recommendation based on success rate and duration differences.
 */

import { getPromptVersion } from '../store/PromptVersionStore.js'
import type { PromptVersionStats } from '../types/promptVersion.js'

// ============ Types ============

export interface VersionComparison {
  version1: { id: string; version: number; stats: PromptVersionStats }
  version2: { id: string; version: number; stats: PromptVersionStats }
  diff: {
    successRateDelta: number
    avgDurationDelta: number
    totalTasksDelta: number
  }
  recommendation: 'prefer_v1' | 'prefer_v2' | 'insufficient_data' | 'no_significant_diff'
}

// ============ Core ============

/** Simple fitness score: higher is better */
function calculateFitness(stats: PromptVersionStats): number {
  // Weighted: 70% success rate, 30% speed (inverse of duration, normalized)
  const successScore = stats.successRate
  // Normalize duration: faster is better, cap at 10min for normalization
  const maxDuration = 10 * 60 * 1000
  const speedScore = 1 - Math.min(stats.avgDurationMs / maxDuration, 1)
  return successScore * 0.7 + speedScore * 0.3
}

/**
 * Compare two prompt versions for a persona.
 *
 * Returns null if either version is not found.
 */
export function compareVersions(
  personaName: string,
  versionId1: string,
  versionId2: string
): VersionComparison | null {
  const v1 = getPromptVersion(personaName, versionId1)
  const v2 = getPromptVersion(personaName, versionId2)

  if (!v1 || !v2) return null

  const diff = {
    successRateDelta: v2.stats.successRate - v1.stats.successRate,
    avgDurationDelta: v2.stats.avgDurationMs - v1.stats.avgDurationMs,
    totalTasksDelta: v2.stats.totalTasks - v1.stats.totalTasks,
  }

  let recommendation: VersionComparison['recommendation']

  if (v1.stats.totalTasks < 3 || v2.stats.totalTasks < 3) {
    recommendation = 'insufficient_data'
  } else if (
    Math.abs(diff.successRateDelta) < 0.05 &&
    (v1.stats.avgDurationMs === 0 ||
      Math.abs(diff.avgDurationDelta) / v1.stats.avgDurationMs < 0.1)
  ) {
    recommendation = 'no_significant_diff'
  } else {
    const fitness1 = calculateFitness(v1.stats)
    const fitness2 = calculateFitness(v2.stats)
    recommendation = fitness2 > fitness1 ? 'prefer_v2' : 'prefer_v1'
  }

  return {
    version1: { id: v1.id, version: v1.version, stats: v1.stats },
    version2: { id: v2.id, version: v2.version, stats: v2.stats },
    diff,
    recommendation,
  }
}
