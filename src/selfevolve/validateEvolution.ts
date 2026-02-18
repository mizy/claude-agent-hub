/**
 * Validate evolution effectiveness.
 *
 * Compares task success rates before and after evolution,
 * and leverages A/B test results from prompt-optimization.
 */

import { getTasksByStatus } from '../store/TaskStore.js'
import { runEvolutionCycle } from '../prompt-optimization/evolutionSelection.js'
import { createLogger } from '../shared/logger.js'
import type { EvolutionValidation } from './types.js'
import { getEvolution, updateEvolution } from './evolutionHistory.js'

const logger = createLogger('selfevolve')

/**
 * Validate whether an evolution cycle produced measurable improvement.
 *
 * Checks:
 * 1. Overall task success rate (before vs after)
 * 2. Per-persona A/B test results via prompt-optimization
 * 3. Failure trend direction
 */
export function validateEvolution(evolutionId: string): EvolutionValidation | null {
  const record = getEvolution(evolutionId)
  if (!record) {
    logger.warn(`Evolution record not found: ${evolutionId}`)
    return null
  }

  // Calculate baseline: success rate from tasks before evolution started
  const startedAt = new Date(record.startedAt).getTime()
  const allCompleted = getTasksByStatus('completed')
  const allFailed = getTasksByStatus('failed')

  const beforeCompleted = allCompleted.filter(t => {
    const created = t.createdAt ? new Date(t.createdAt).getTime() : 0
    return created < startedAt
  })
  const beforeFailed = allFailed.filter(t => {
    const created = t.createdAt ? new Date(t.createdAt).getTime() : 0
    return created < startedAt
  })

  const beforeTotal = beforeCompleted.length + beforeFailed.length
  const baselineSuccessRate = beforeTotal > 0 ? beforeCompleted.length / beforeTotal : 0

  // Calculate current: success rate from tasks after evolution
  const afterCompleted = allCompleted.filter(t => {
    const created = t.createdAt ? new Date(t.createdAt).getTime() : 0
    return created >= startedAt
  })
  const afterFailed = allFailed.filter(t => {
    const created = t.createdAt ? new Date(t.createdAt).getTime() : 0
    return created >= startedAt
  })

  const afterTotal = afterCompleted.length + afterFailed.length
  const currentSuccessRate = afterTotal > 0 ? afterCompleted.length / afterTotal : 0

  // Run per-persona evolution cycles to check A/B test results
  const personas = getAffectedPersonas(record)
  const personaReports = personas.map(p => runEvolutionCycle(p))

  // Determine if improved
  const improved =
    afterTotal >= 3 && // Need enough samples
    currentSuccessRate > baselineSuccessRate &&
    personaReports.every(r => r.failureTrend !== 'degrading')

  const summary = buildSummary(
    baselineSuccessRate,
    currentSuccessRate,
    beforeTotal,
    afterTotal,
    personaReports
  )

  const validation: EvolutionValidation = {
    baselineSuccessRate,
    currentSuccessRate,
    sampleSize: afterTotal,
    improved,
    summary,
  }

  // Update evolution record with validation
  updateEvolution(evolutionId, { validation })

  logger.info(
    `Evolution ${evolutionId} validation: ${improved ? 'improved' : 'no improvement'} ` +
      `(${(baselineSuccessRate * 100).toFixed(0)}% → ${(currentSuccessRate * 100).toFixed(0)}%, n=${afterTotal})`
  )

  return validation
}

/** Get persona names affected by an evolution record */
function getAffectedPersonas(
  record: { improvements: Array<{ personaName?: string }> }
): string[] {
  const personas = new Set<string>()
  for (const imp of record.improvements) {
    if (imp.personaName) personas.add(imp.personaName)
  }
  // If no specific persona, check all personas with versions
  if (personas.size === 0) {
    personas.add('Pragmatist')
  }
  return Array.from(personas)
}

function buildSummary(
  baseline: number,
  current: number,
  beforeN: number,
  afterN: number,
  personaReports: Array<{ personaName: string; failureTrend: string }>
): string {
  const parts: string[] = []

  parts.push(
    `Success rate: ${(baseline * 100).toFixed(0)}% (n=${beforeN}) → ${(current * 100).toFixed(0)}% (n=${afterN})`
  )

  for (const report of personaReports) {
    parts.push(`${report.personaName}: trend=${report.failureTrend}`)
  }

  if (afterN < 3) {
    parts.push('Insufficient samples for reliable validation')
  }

  return parts.join('. ')
}
