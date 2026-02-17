/**
 * A/B Testing framework for prompt versions
 *
 * Creates tests between active (control) and candidate versions,
 * randomly selects variants during execution, evaluates results,
 * and promotes winners.
 */

import { join } from 'path'
import { FileStore } from '../store/GenericFileStore.js'
import { DATA_DIR } from '../store/paths.js'
import {
  getActiveVersion,
  getPromptVersion,
  rollbackToVersion,
} from '../store/PromptVersionStore.js'
import { generateShortId } from '../shared/generateId.js'
import { createLogger } from '../shared/logger.js'
import type { PromptVersionStats } from '../types/promptVersion.js'

const logger = createLogger('ab-testing')

// ============ Types ============

export interface ABTest {
  id: string
  personaName: string
  controlVersionId: string // active version
  candidateVersionId: string // candidate version
  status: 'running' | 'concluded'
  minSamples: number // min executions per variant (default 5)
  createdAt: string
  concludedAt?: string
  result?: ABTestResult
}

export interface ABTestResult {
  winner: 'control' | 'candidate' | 'inconclusive'
  controlStats: PromptVersionStats
  candidateStats: PromptVersionStats
  fitnessControl: number
  fitnessCandidate: number
  recommendation: string
}

// ============ Store ============

const AB_TESTS_DIR = join(DATA_DIR, 'ab-tests')

let store: FileStore<ABTest> | null = null

function getStore(): FileStore<ABTest> {
  if (!store) {
    store = new FileStore<ABTest>({ dir: AB_TESTS_DIR, mode: 'file' })
  }
  return store
}

/** @internal - for testing only: reset and optionally clean all data */
export function resetStore(clean = false): void {
  if (clean && store) {
    for (const id of store.listSync()) {
      store.deleteSync(id)
    }
  }
  store = null
}

// ============ Core Functions ============

/** Create a new A/B test between active and candidate versions */
export function createABTest(
  personaName: string,
  candidateVersionId: string,
  minSamples = 5
): ABTest {
  const active = getActiveVersion(personaName)
  if (!active) {
    throw new Error(`No active version found for persona "${personaName}"`)
  }

  const candidate = getPromptVersion(personaName, candidateVersionId)
  if (!candidate) {
    throw new Error(`Candidate version "${candidateVersionId}" not found`)
  }

  const test: ABTest = {
    id: `ab-${Date.now()}-${generateShortId()}`,
    personaName,
    controlVersionId: active.id,
    candidateVersionId,
    status: 'running',
    minSamples,
    createdAt: new Date().toISOString(),
  }

  getStore().setSync(test.id, test)
  logger.info(`Created A/B test ${test.id}: ${active.id} vs ${candidateVersionId}`)
  return test
}

/**
 * Select a variant for a persona with a running A/B test.
 * Returns the versionId to use, or null if no test is running.
 * 50/50 random split.
 */
export function selectVariant(personaName: string): string | null {
  const test = getRunningTest(personaName)
  if (!test) return null

  const useCandidate = Math.random() < 0.5
  const versionId = useCandidate ? test.candidateVersionId : test.controlVersionId
  logger.debug(
    `A/B test ${test.id}: selected ${useCandidate ? 'candidate' : 'control'} (${versionId})`
  )
  return versionId
}

/**
 * Evaluate an A/B test. Returns result if both variants have enough samples,
 * or null if more data is needed.
 */
export function evaluateABTest(testId: string): ABTestResult | null {
  const test = getStore().getSync(testId)
  if (!test || test.status !== 'running') return null

  const controlVersion = getPromptVersion(test.personaName, test.controlVersionId)
  const candidateVersion = getPromptVersion(test.personaName, test.candidateVersionId)
  if (!controlVersion || !candidateVersion) return null

  const controlStats = controlVersion.stats
  const candidateStats = candidateVersion.stats

  // Need minimum samples for both
  if (controlStats.totalTasks < test.minSamples || candidateStats.totalTasks < test.minSamples) {
    return null
  }

  const fitnessControl = calculateFitness(controlStats)
  const fitnessCandidate = calculateFitness(candidateStats)

  let winner: ABTestResult['winner']
  let recommendation: string

  const delta = Math.abs(fitnessCandidate - fitnessControl)
  if (delta < 0.05) {
    winner = 'inconclusive'
    recommendation = `Fitness difference too small (${delta.toFixed(3)}). Consider extending the test or keeping the current version.`
  } else if (fitnessCandidate > fitnessControl) {
    winner = 'candidate'
    recommendation = `Candidate outperforms control (${fitnessCandidate.toFixed(3)} vs ${fitnessControl.toFixed(3)}). Recommend promoting candidate.`
  } else {
    winner = 'control'
    recommendation = `Control outperforms candidate (${fitnessControl.toFixed(3)} vs ${fitnessCandidate.toFixed(3)}). Recommend keeping current version.`
  }

  return { winner, controlStats, candidateStats, fitnessControl, fitnessCandidate, recommendation }
}

/** Conclude an A/B test. If candidate wins, promote it to active. */
export function concludeABTest(testId: string): void {
  const test = getStore().getSync(testId)
  if (!test || test.status !== 'running') return

  const result = evaluateABTest(testId)

  const updates: Partial<ABTest> = {
    status: 'concluded' as const,
    concludedAt: new Date().toISOString(),
    result: result ?? {
      winner: 'inconclusive',
      controlStats: { totalTasks: 0, successCount: 0, failureCount: 0, successRate: 0, avgDurationMs: 0 },
      candidateStats: { totalTasks: 0, successCount: 0, failureCount: 0, successRate: 0, avgDurationMs: 0 },
      fitnessControl: 0,
      fitnessCandidate: 0,
      recommendation: 'Test concluded with insufficient data.',
    },
  }

  getStore().updateSync(testId, updates)

  if (result?.winner === 'candidate') {
    logger.info(`A/B test ${testId}: promoting candidate ${test.candidateVersionId}`)
    rollbackToVersion(test.personaName, test.candidateVersionId)
  } else {
    logger.info(`A/B test ${testId}: keeping control (winner=${result?.winner ?? 'inconclusive'})`)
  }
}

/**
 * Calculate fitness score for a prompt version's stats.
 * Formula: successRate * 0.6 + speedScore * 0.2 + efficiencyScore * 0.1 + 0.1 (default satisfaction)
 */
export function calculateFitness(stats: PromptVersionStats): number {
  const MAX_DURATION = 600_000 // 10 min

  const successScore = stats.successRate
  const speedScore = 1 - Math.min(stats.avgDurationMs / MAX_DURATION, 1)
  // No node count in current stats — use 0.5 as neutral placeholder
  const efficiencyScore = 0.5
  const satisfactionScore = 1 // default

  return successScore * 0.6 + speedScore * 0.2 + efficiencyScore * 0.1 + satisfactionScore * 0.1
}

// ============ Helpers ============

/** Get the running A/B test for a persona (at most one) */
export function getRunningTest(personaName: string): ABTest | null {
  const tests = getStore().getAllSync()
  return tests.find(t => t.personaName === personaName && t.status === 'running') ?? null
}
