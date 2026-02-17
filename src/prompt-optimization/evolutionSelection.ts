/**
 * Evolution Selection Engine
 *
 * Automates the "natural selection" cycle for prompt versions:
 * - Retires underperforming candidates after A/B test conclusion
 * - Cleans up stale candidates that never entered testing
 * - Triggers extraction of success patterns after enough tasks complete
 * - Reports evolution status
 */

import { getAllVersions, retireVersion } from '../store/PromptVersionStore.js'
import { createLogger } from '../shared/logger.js'
import { getRunningTest, evaluateABTest, concludeABTest } from './abTesting.js'
import { extractSuccessPatterns, savePattern, getAllPatterns } from './extractSuccessPattern.js'
import { computeFailureStats } from './failureKnowledgeBase.js'
import type { Task } from '../types/task.js'

const logger = createLogger('evolution')

// ============ Types ============

export interface EvolutionReport {
  personaName: string
  activeVersion: { id: string; version: number; successRate: number; totalTasks: number } | null
  candidateVersions: number
  retiredVersions: number
  runningABTest: boolean
  failureTrend: 'improving' | 'degrading' | 'stable'
  patternsExtracted: number
}

// ============ Core Functions ============

/**
 * Run a full evolution cycle for a persona:
 * 1. Check and conclude any running A/B test
 * 2. Retire stale candidates (> 7 days without entering A/B test)
 * 3. Return evolution status report
 */
export function runEvolutionCycle(personaName: string): EvolutionReport {
  // 1. Conclude running A/B test if ready
  const runningTest = getRunningTest(personaName)
  if (runningTest) {
    const result = evaluateABTest(runningTest.id)
    if (result) {
      concludeABTest(runningTest.id)
      logger.info(`Evolution: A/B test ${runningTest.id} concluded, winner=${result.winner}`)
    }
  }

  // 2. Retire stale candidates
  retireStaleCandidates(personaName)

  // 3. Build status report
  const versions = getAllVersions(personaName)
  const active = versions.find(v => v.status === 'active')
  const candidates = versions.filter(v => v.status === 'candidate')
  const retired = versions.filter(v => v.status === 'retired')
  const failureStats = computeFailureStats(personaName)

  return {
    personaName,
    activeVersion: active
      ? {
          id: active.id,
          version: active.version,
          successRate: active.stats.successRate,
          totalTasks: active.stats.totalTasks,
        }
      : null,
    candidateVersions: candidates.length,
    retiredVersions: retired.length,
    runningABTest: !!getRunningTest(personaName),
    failureTrend: failureStats.recentTrend,
    patternsExtracted: getAllPatterns().length,
  }
}

/**
 * Retire candidate versions that have been idle too long.
 * A candidate older than maxAgeDays that isn't part of a running A/B test gets retired.
 */
function retireStaleCandidates(personaName: string, maxAgeDays = 7): void {
  const versions = getAllVersions(personaName)
  const cutoff = Date.now() - maxAgeDays * 86400_000
  const runningTest = getRunningTest(personaName)

  for (const version of versions) {
    if (version.status !== 'candidate') continue

    const createdAt = new Date(version.createdAt).getTime()
    if (createdAt >= cutoff) continue

    // Don't retire versions in active A/B tests
    if (
      runningTest &&
      (runningTest.candidateVersionId === version.id || runningTest.controlVersionId === version.id)
    ) {
      continue
    }

    retireVersion(personaName, version.id)
    logger.info(
      `Evolution: retired stale candidate ${version.id} (v${version.version}) for ${personaName} — idle ${Math.round((Date.now() - createdAt) / 86400_000)} days`
    )
  }
}

/**
 * Extract and persist success patterns from completed tasks.
 * Should be called periodically (e.g., after every N completed tasks).
 */
export function refreshSuccessPatterns(completedTasks: Task[]): number {
  const existingCount = getAllPatterns().length
  const patterns = extractSuccessPatterns(completedTasks)

  let savedCount = 0
  for (const pattern of patterns) {
    if (pattern.sampleCount >= 2) {
      savePattern(pattern)
      savedCount++
    }
  }

  if (savedCount > 0) {
    logger.info(`Evolution: extracted ${savedCount} success patterns (was ${existingCount})`)
  }

  return savedCount
}
