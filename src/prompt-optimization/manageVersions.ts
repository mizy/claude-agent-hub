/**
 * Version management functions for prompt optimization.
 *
 * Wraps PromptVersionStore with higher-level operations:
 * - saveNewVersion: create and persist a new prompt version
 * - getActivePrompt: get the active prompt for a persona
 * - rollbackVersion: rollback to a previous version
 * - recordUsage: record task execution result and update stats
 */

import {
  generateVersionId,
  savePromptVersion,
  getActiveVersion,
  getPromptVersion,
  updatePromptVersionStats,
  rollbackToVersion,
} from '../store/PromptVersionStore.js'
import { createLogger } from '../shared/logger.js'
import type { PromptVersion } from '../types/promptVersion.js'

const logger = createLogger('prompt-optimization')

/**
 * Create and save a new prompt version (as 'active' — first version for a persona).
 *
 * For candidate versions created via optimization, use generateImprovement() instead.
 */
export function saveNewVersion(
  personaName: string,
  systemPrompt: string,
  changelog: string,
  parentVersionId?: string,
  version?: number
): PromptVersion {
  const newVersion: PromptVersion = {
    id: generateVersionId(),
    personaName,
    parentVersionId,
    version: version ?? 1,
    systemPrompt,
    changelog,
    stats: {
      totalTasks: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      avgDurationMs: 0,
    },
    status: 'active',
    createdAt: new Date().toISOString(),
  }

  savePromptVersion(newVersion)
  logger.info(`Saved new version ${personaName} v${newVersion.version}`)
  return newVersion
}

/**
 * Get the active prompt content for a persona.
 *
 * Returns the systemPrompt string of the active version, or null if no version exists.
 */
export function getActivePrompt(personaName: string): string | null {
  const version = getActiveVersion(personaName)
  return version?.systemPrompt ?? null
}

/**
 * Rollback a persona to a specific version.
 *
 * Delegates to PromptVersionStore.rollbackToVersion which handles
 * retiring the current active version.
 */
export function rollbackVersion(
  personaName: string,
  targetVersionId: string
): PromptVersion | null {
  const result = rollbackToVersion(personaName, targetVersionId)
  if (result) {
    logger.info(`Rolled back ${personaName} to version ${result.version} (${result.id})`)
  } else {
    logger.warn(`Rollback failed: version ${targetVersionId} not found for ${personaName}`)
  }
  return result
}

/**
 * Record a task execution result for a prompt version.
 *
 * Updates the version's aggregated stats (success count, failure count, rate, avg duration).
 */
export function recordUsage(
  personaName: string,
  versionId: string,
  success: boolean,
  durationMs: number
): void {
  const version = getPromptVersion(personaName, versionId)
  if (!version) {
    logger.warn(`Cannot record usage: version ${versionId} not found for ${personaName}`)
    return
  }

  const stats = { ...version.stats }
  stats.totalTasks += 1
  if (success) {
    stats.successCount += 1
  } else {
    stats.failureCount += 1
  }
  stats.successRate = stats.totalTasks > 0 ? stats.successCount / stats.totalTasks : 0

  // Rolling average for duration
  if (stats.avgDurationMs === 0) {
    stats.avgDurationMs = durationMs
  } else {
    stats.avgDurationMs = Math.round(
      (stats.avgDurationMs * (stats.totalTasks - 1) + durationMs) / stats.totalTasks
    )
  }
  stats.lastUsedAt = new Date().toISOString()

  updatePromptVersionStats(personaName, versionId, stats)
  logger.debug(
    `Recorded usage for ${personaName} ${versionId}: ${success ? 'success' : 'failure'} ` +
      `(${stats.successRate.toFixed(2)} rate, ${stats.totalTasks} tasks)`
  )
}
