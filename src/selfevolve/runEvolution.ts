/**
 * Orchestrate a full evolution cycle: analyze → review → improve → record.
 *
 * This is the main entry point for triggering self-evolution.
 * Validation happens separately (after enough new tasks complete).
 */

import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { generateShortId } from '../shared/generateId.js'
import { refreshSuccessPatterns } from '../prompt-optimization/evolutionSelection.js'
import { getTasksByStatus } from '../store/TaskStore.js'
import { analyzeTaskPatterns } from './analyzeTaskPatterns.js'
import { analyzePerformance } from './analyzePerformance.js'
import { applyImprovements } from './applyImprovements.js'
import { reviewImprovements } from './reviewImprovement.js'
import {
  generateEvolutionId,
  listEvolutions,
  recordEvolution,
  updateEvolution,
} from './evolutionHistory.js'
import type { EvolutionRecord, Improvement, FailurePattern, PerformancePattern } from './types.js'
import type { SignalEvent } from './signalDetector.js'

const logger = createLogger('selfevolve')

interface RunEvolutionOptions {
  /** What triggered this evolution */
  trigger?: 'manual' | 'scheduled' | 'threshold' | 'signal'
  /** Max failures to analyze */
  limit?: number
  /** Only analyze failures since this date */
  since?: Date
  /** Skip applying improvements (dry-run) */
  dryRun?: boolean
  /** Signal that triggered this evolution (when trigger === 'signal') */
  signal?: SignalEvent
}

interface EvolutionCycleResult {
  evolutionId: string
  record: EvolutionRecord
}

/**
 * Run a complete evolution cycle:
 *
 * 1. Analyze recent failures (if any) → extract failure patterns
 * 2. Analyze all task performance (completed + failed) → detect efficiency issues
 * 3. Convert patterns to improvement proposals
 * 4. Agent review → filter improvements
 * 5. Apply approved improvements
 * 6. Refresh success patterns from completed tasks
 * 7. Record evolution history
 *
 * Note: Most learning comes from performance analysis of all tasks (step 2),
 * not just failures. Even when no tasks have failed, the system can still
 * detect optimization opportunities from successful task execution.
 */
export async function runEvolutionCycle(
  options?: RunEvolutionOptions
): Promise<EvolutionCycleResult> {
  const evolutionId = generateEvolutionId()
  const trigger = options?.trigger ?? 'manual'

  logger.info(`Starting evolution cycle ${evolutionId} (trigger: ${trigger})`)

  // Create initial record
  const record: EvolutionRecord = {
    id: evolutionId,
    status: 'running',
    startedAt: new Date().toISOString(),
    trigger,
    patterns: [],
    improvements: [],
    ...(options?.signal && {
      signalContext: {
        type: options.signal.type,
        pattern: options.signal.pattern,
        severity: options.signal.severity,
        taskIds: options.signal.taskIds,
      },
    }),
  }
  recordEvolution(record)

  try {
    // Load evolution history for dedup
    const history = listEvolutions()

    // When triggered by signal, focus analysis on signal's related tasks
    const signalTaskIds = options?.signal?.taskIds

    // Step 1: Analyze task patterns (failures + optimization opportunities from completed tasks)
    const analysis = analyzeTaskPatterns({
      limit: options?.limit,
      since: options?.since,
      taskIds: signalTaskIds,
      history,
    })
    record.patterns = analysis.patterns
    // Record which tasks were analyzed for future dedup
    record.analyzedTaskIds = analysis.patterns.flatMap(p => p.taskIds)
      .filter((id, i, arr) => arr.indexOf(id) === i)
    if (analysis.patterns.length > 0) {
      const newCount = analysis.patterns.filter(p => p.isNew).length
      logger.info(`Found ${analysis.patterns.length} patterns (${newCount} new) from ${analysis.totalExamined} tasks`)
    }

    // Step 2: Analyze all task performance (completed + failed)
    // Skip broad performance analysis for signal-triggered evolution (focus on signal's root cause)
    const perfResult = signalTaskIds
      ? { totalExamined: 0, avgDurationMs: 0, avgCostUsd: 0, successRate: 0, patterns: [], nodeHotspots: [] }
      : analyzePerformance({
          limit: options?.limit,
          since: options?.since,
        })
    record.performanceAnalysis = perfResult
    logger.info(`Performance analysis: ${perfResult.totalExamined} tasks examined, ${perfResult.patterns.length} patterns found`)

    // No patterns from any source → nothing to improve
    if (analysis.patterns.length === 0 && perfResult.patterns.length === 0) {
      logger.info('No failure patterns or performance issues — evolution cycle complete (no changes)')
      record.status = 'completed'
      record.completedAt = new Date().toISOString()
      updateEvolution(evolutionId, record)
      return { evolutionId, record }
    }

    // Early termination: all patterns already known and no new perf patterns
    const hasNewPatterns = analysis.patterns.some(p => p.isNew)
    if (!hasNewPatterns && perfResult.patterns.length === 0) {
      logger.info('All patterns already known, no new performance issues — skipping this cycle')
      record.status = 'completed'
      record.completedAt = new Date().toISOString()
      updateEvolution(evolutionId, record)
      return { evolutionId, record }
    }

    // Step 3: Convert patterns to improvements (with history dedup)
    const improvements = patternsToImprovements(
      analysis.patterns,
      analysis.personaBreakdown,
      perfResult.patterns,
      history
    )

    if (improvements.length === 0) {
      logger.info('No improvements generated — evolution cycle complete')
      record.status = 'completed'
      record.completedAt = new Date().toISOString()
      updateEvolution(evolutionId, record)
      return { evolutionId, record }
    }

    // Step 4: Agent review (skip in dry-run mode)
    let approvedImprovements = improvements
    if (!options?.dryRun) {
      const reviewResults = await reviewImprovements(improvements, {
        patterns: record.patterns,
        performancePatterns: perfResult.patterns,
      })
      record.reviewResults = reviewResults

      // Filter: keep only approved improvements
      const approvedIds = new Set(
        reviewResults.filter(r => r.review.approved).map(r => r.improvementId)
      )
      approvedImprovements = improvements.filter(imp => approvedIds.has(imp.id))

      const rejectedCount = improvements.length - approvedImprovements.length
      if (rejectedCount > 0) {
        logger.info(`Review rejected ${rejectedCount}/${improvements.length} improvements`)
      }
    }

    record.improvements = approvedImprovements

    // Step 5: Apply approved improvements
    if (!options?.dryRun && approvedImprovements.length > 0) {
      const results = await applyImprovements(approvedImprovements)
      for (const result of results) {
        const imp = record.improvements.find(i => i.id === result.improvementId)
        if (imp && !result.applied) {
          imp.detail = `${imp.detail} [NOT APPLIED: ${result.message}]`
        }
      }
    }

    // Step 6: Refresh success patterns from completed tasks
    const completedTasks = getTasksByStatus('completed').slice(-50)
    if (completedTasks.length > 0) {
      const patternCount = refreshSuccessPatterns(completedTasks)
      logger.info(`Refreshed ${patternCount} success patterns`)
    }

    record.status = 'completed'
    record.completedAt = new Date().toISOString()
  } catch (e) {
    const msg = getErrorMessage(e)
    logger.error(`Evolution cycle ${evolutionId} failed: ${msg}`)
    record.status = 'failed'
    record.error = msg
    record.completedAt = new Date().toISOString()
  }

  updateEvolution(evolutionId, record)
  logger.info(
    `Evolution cycle ${evolutionId} ${record.status}: ` +
      `${record.patterns.length} patterns, ${record.improvements.length} improvements`
  )

  return { evolutionId, record }
}

/**
 * Convert failure patterns and performance patterns into concrete improvement proposals.
 * Prioritizes prompt-related patterns for personas with most failures.
 */
function patternsToImprovements(
  patterns: FailurePattern[],
  personaBreakdown: Record<string, { failures: number; topCategory: string }>,
  performancePatterns?: PerformancePattern[],
  history?: EvolutionRecord[]
): Improvement[] {
  const improvements: Improvement[] = []

  // Build set of previously applied improvement descriptions for dedup
  const appliedDescriptions = new Set<string>()
  if (history) {
    for (const evo of history) {
      for (const imp of evo.improvements) {
        appliedDescriptions.add(imp.description)
      }
    }
  }

  let skippedCount = 0

  // From failure patterns (existing logic)
  for (const pattern of patterns) {
    if (pattern.occurrences < 2) continue
    if (pattern.taskIds.length === 0) continue

    // Skip patterns that already produced applied improvements
    if (appliedDescriptions.has(pattern.description)) {
      skippedCount++
      continue
    }

    const id = `imp-${generateShortId()}`
    const triggerId = pattern.taskIds[0]!

    if (pattern.category === 'prompt') {
      const topPersona = findTopPersona(personaBreakdown)

      improvements.push({
        id,
        source: 'prompt',
        description: pattern.description,
        personaName: topPersona,
        detail: `Prompt improvement for ${topPersona}: ${pattern.description}`,
        triggeredBy: triggerId,
      })
    } else {
      improvements.push({
        id,
        source: pattern.category,
        description: pattern.description,
        detail: `${pattern.category} issue: ${pattern.description} (${pattern.occurrences} occurrences)`,
        triggeredBy: triggerId,
      })
    }
  }

  // From performance patterns (new)
  if (performancePatterns) {
    for (const perf of performancePatterns) {
      if (perf.taskIds.length === 0) continue

      const perfDescription = `[Performance] ${perf.description}`
      if (appliedDescriptions.has(perfDescription)) {
        skippedCount++
        continue
      }

      const id = `imp-${generateShortId()}`
      improvements.push({
        id,
        source: 'workflow',
        description: `[Performance] ${perf.description}`,
        detail: `${perf.suggestion} (severity: ${perf.severity}, ${perf.category}: ${perf.value.toFixed(2)} > threshold ${perf.threshold.toFixed(2)})`,
        triggeredBy: perf.taskIds[0]!,
      })
    }
  }

  if (skippedCount > 0) {
    logger.info(`Skipped ${skippedCount} duplicate improvements (already applied in previous evolutions)`)
  }

  return improvements
}

function findTopPersona(
  breakdown: Record<string, { failures: number; topCategory: string }>
): string {
  let topPersona = 'Pragmatist'
  let maxFailures = 0
  for (const [persona, stats] of Object.entries(breakdown)) {
    if (stats.failures > maxFailures) {
      topPersona = persona
      maxFailures = stats.failures
    }
  }
  return topPersona
}
