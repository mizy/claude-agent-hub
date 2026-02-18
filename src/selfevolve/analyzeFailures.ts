/**
 * Analyze recent failed tasks to extract failure patterns and improvement opportunities.
 *
 * Aggregates failures from TaskStore + FailureKnowledgeBase to find recurring
 * patterns that can drive prompt or workflow improvements.
 */

import { getTasksByStatus } from '../store/TaskStore.js'
import { getTaskWorkflow, getTaskInstance } from '../store/TaskWorkflowStore.js'
import {
  classifyFailure,
  type FailureClassification,
} from '../prompt-optimization/classifyFailure.js'
import { extractFailedNodes } from '../prompt-optimization/analyzeFailure.js'
// failureKnowledgeBase available for future enrichment
import { createLogger } from '../shared/logger.js'
import type { Task } from '../types/task.js'
import type { FailurePattern, ImprovementSource } from './types.js'

const logger = createLogger('selfevolve')

interface AnalyzeOptions {
  /** Max number of failed tasks to analyze */
  limit?: number
  /** Only analyze tasks created after this date */
  since?: Date
}

interface FailureAnalysisResult {
  /** Total failed tasks examined */
  totalExamined: number
  /** Grouped failure patterns */
  patterns: FailurePattern[]
  /** Per-persona breakdown */
  personaBreakdown: Record<string, { failures: number; topCategory: string }>
}

/** Map FailureClassification category to ImprovementSource */
function mapCategory(category: string): ImprovementSource {
  switch (category) {
    case 'planning':
    case 'prompt':
      return 'prompt'
    case 'execution':
      return 'workflow'
    case 'resource':
      return 'resource'
    case 'validation':
      return 'workflow'
    default:
      return 'environment'
  }
}

/** Get persona name from a task's workflow */
function getPersonaFromWorkflow(taskId: string): string {
  const workflow = getTaskWorkflow(taskId)
  if (!workflow) return 'unknown'
  const taskNode = workflow.nodes.find(n => n.type === 'task' && n.task?.persona)
  return taskNode?.task?.persona ?? 'Pragmatist'
}

/**
 * Analyze recent failures and extract recurring patterns.
 *
 * Groups failures by category and returns actionable patterns
 * sorted by occurrence count (most frequent first).
 */
export function analyzeRecentFailures(options?: AnalyzeOptions): FailureAnalysisResult {
  const limit = options?.limit ?? 50
  const since = options?.since

  // Get failed tasks
  const failedTasks = getTasksByStatus('failed')
  let tasks = failedTasks.slice(-limit)

  if (since) {
    const sinceMs = since.getTime()
    tasks = tasks.filter(t => {
      const created = t.createdAt ? new Date(t.createdAt).getTime() : 0
      return created >= sinceMs
    })
  }

  if (tasks.length === 0) {
    logger.info('No failed tasks found for analysis')
    return { totalExamined: 0, patterns: [], personaBreakdown: {} }
  }

  logger.info(`Analyzing ${tasks.length} failed tasks`)

  // Classify each failure and group into patterns
  const patternMap = new Map<string, FailurePattern>()
  const personaMap = new Map<string, { failures: number; categories: Map<string, number> }>()

  for (const task of tasks) {
    const classification = classifyTaskFailure(task)
    if (!classification) continue

    const source = mapCategory(classification.category)
    const key = `${source}:${classification.category}`

    // Aggregate into pattern
    const existing = patternMap.get(key)
    if (existing) {
      existing.occurrences++
      existing.taskIds.push(task.id)
      if (existing.sampleErrors.length < 3) {
        existing.sampleErrors.push(classification.raw.slice(0, 200))
      }
    } else {
      patternMap.set(key, {
        category: source,
        description: `${classification.category} failures (patterns: ${classification.matchedPatterns.join(', ') || 'none'})`,
        occurrences: 1,
        taskIds: [task.id],
        sampleErrors: [classification.raw.slice(0, 200)],
      })
    }

    // Track per-persona stats
    const persona = getPersonaFromWorkflow(task.id)
    const personaStats = personaMap.get(persona) ?? { failures: 0, categories: new Map() }
    personaStats.failures++
    personaStats.categories.set(
      classification.category,
      (personaStats.categories.get(classification.category) ?? 0) + 1
    )
    personaMap.set(persona, personaStats)
  }

  // Sort patterns by occurrence count
  const patterns = Array.from(patternMap.values()).sort((a, b) => b.occurrences - a.occurrences)

  // Build persona breakdown
  const personaBreakdown: Record<string, { failures: number; topCategory: string }> = {}
  for (const [persona, stats] of personaMap) {
    let topCategory = 'unknown'
    let topCount = 0
    for (const [cat, count] of stats.categories) {
      if (count > topCount) {
        topCategory = cat
        topCount = count
      }
    }
    personaBreakdown[persona] = { failures: stats.failures, topCategory }
  }

  logger.info(`Found ${patterns.length} failure patterns across ${tasks.length} tasks`)

  return {
    totalExamined: tasks.length,
    patterns,
    personaBreakdown,
  }
}

/** Classify a single task's failure using workflow/instance data */
function classifyTaskFailure(task: Task): FailureClassification | null {
  const workflow = getTaskWorkflow(task.id)
  const instance = getTaskInstance(task.id)

  if (!workflow || !instance) {
    // No workflow data — classify from task error field
    if (task.error) {
      return {
        category: 'unknown',
        confidence: 0.3,
        matchedPatterns: [],
        raw: task.error,
      }
    }
    return null
  }

  const failedNodes = extractFailedNodes(workflow, instance)
  if (failedNodes.length === 0) return null

  return classifyFailure(failedNodes)
}
