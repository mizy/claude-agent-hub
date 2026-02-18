/**
 * Analyze recent tasks (failed + completed) to extract failure patterns
 * and optimization opportunities.
 *
 * Extends the original failure-only analysis to also examine completed tasks
 * for retry patterns (nodes that succeeded after retries = instability signals).
 */

import { getTasksByStatus } from '../store/TaskStore.js'
import { getTaskWorkflow, getTaskInstance } from '../store/TaskWorkflowStore.js'
import {
  classifyFailure,
  type FailureClassification,
} from '../prompt-optimization/classifyFailure.js'
import { extractFailedNodes } from '../prompt-optimization/analyzeFailure.js'
import { createLogger } from '../shared/logger.js'
import type { Task } from '../types/task.js'
import type { FailurePattern, ImprovementSource } from './types.js'

const logger = createLogger('selfevolve')

interface AnalyzeOptions {
  /** Max number of tasks to analyze per status */
  limit?: number
  /** Only analyze tasks created after this date */
  since?: Date
  /** Which statuses to include (default: completed + failed) */
  statuses?: Array<'completed' | 'failed'>
}

export interface TaskAnalysisResult {
  /** Total tasks examined */
  totalExamined: number
  /** Grouped patterns (from failures and optimization opportunities) */
  patterns: FailurePattern[]
  /** Per-persona breakdown with success and failure counts */
  personaBreakdown: Record<
    string,
    { failures: number; successes: number; topCategory: string }
  >
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
 * Analyze recent tasks and extract patterns.
 *
 * - Failed tasks: classify errors into failure patterns (same as before)
 * - Completed tasks: detect nodes that succeeded after retries (instability signals)
 *
 * Returns patterns sorted by occurrence count (most frequent first).
 */
export function analyzeTaskPatterns(options?: AnalyzeOptions): TaskAnalysisResult {
  const limit = options?.limit ?? 50
  const since = options?.since
  const statuses = options?.statuses ?? ['completed', 'failed']

  // Collect tasks from requested statuses
  const allTasks: Task[] = []
  for (const status of statuses) {
    allTasks.push(...getTasksByStatus(status))
  }

  // Filter by date
  let tasks = allTasks
  if (since) {
    const sinceMs = since.getTime()
    tasks = tasks.filter(t => {
      const created = t.createdAt ? new Date(t.createdAt).getTime() : 0
      return created >= sinceMs
    })
  }

  // Take most recent
  tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  tasks = tasks.slice(0, limit)

  if (tasks.length === 0) {
    logger.info('No tasks found for pattern analysis')
    return { totalExamined: 0, patterns: [], personaBreakdown: {} }
  }

  logger.info(`Analyzing ${tasks.length} tasks for patterns`)

  const patternMap = new Map<string, FailurePattern>()
  const personaMap = new Map<
    string,
    { failures: number; successes: number; categories: Map<string, number> }
  >()

  for (const task of tasks) {
    const persona = getPersonaFromWorkflow(task.id)
    const personaStats = personaMap.get(persona) ?? {
      failures: 0,
      successes: 0,
      categories: new Map(),
    }

    if (task.status === 'failed') {
      // Failure analysis (original logic)
      personaStats.failures++
      const classification = classifyTaskFailure(task)
      if (classification) {
        const source = mapCategory(classification.category)
        const key = `failure:${source}:${classification.category}`
        addToPatternMap(patternMap, key, source, classification, task.id)
        personaStats.categories.set(
          classification.category,
          (personaStats.categories.get(classification.category) ?? 0) + 1
        )
      }
    } else if (task.status === 'completed') {
      // Optimization: detect retried-but-succeeded nodes
      personaStats.successes++
      const retryPattern = detectRetryInstability(task.id)
      if (retryPattern) {
        const key = 'optimization:retry_instability'
        const existing = patternMap.get(key)
        if (existing) {
          existing.occurrences++
          existing.taskIds.push(task.id)
          if (existing.sampleErrors.length < 3) {
            existing.sampleErrors.push(retryPattern)
          }
        } else {
          patternMap.set(key, {
            category: 'workflow',
            description: 'Nodes succeeded after retries — potential instability points',
            occurrences: 1,
            taskIds: [task.id],
            sampleErrors: [retryPattern],
          })
        }
        personaStats.categories.set(
          'retry_instability',
          (personaStats.categories.get('retry_instability') ?? 0) + 1
        )
      }
    }

    personaMap.set(persona, personaStats)
  }

  // Sort patterns by occurrence
  const patterns = Array.from(patternMap.values()).sort(
    (a, b) => b.occurrences - a.occurrences
  )

  // Build persona breakdown
  const personaBreakdown: Record<
    string,
    { failures: number; successes: number; topCategory: string }
  > = {}
  for (const [persona, stats] of personaMap) {
    let topCategory = 'unknown'
    let topCount = 0
    for (const [cat, count] of stats.categories) {
      if (count > topCount) {
        topCategory = cat
        topCount = count
      }
    }
    personaBreakdown[persona] = {
      failures: stats.failures,
      successes: stats.successes,
      topCategory,
    }
  }

  logger.info(
    `Found ${patterns.length} patterns across ${tasks.length} tasks`
  )

  return { totalExamined: tasks.length, patterns, personaBreakdown }
}

/** Backward-compatible alias */
export function analyzeRecentFailures(options?: {
  limit?: number
  since?: Date
}): TaskAnalysisResult {
  return analyzeTaskPatterns({
    ...options,
    statuses: ['failed'],
  })
}

function addToPatternMap(
  map: Map<string, FailurePattern>,
  key: string,
  source: ImprovementSource,
  classification: FailureClassification,
  taskId: string
): void {
  const existing = map.get(key)
  if (existing) {
    existing.occurrences++
    existing.taskIds.push(taskId)
    if (existing.sampleErrors.length < 3) {
      existing.sampleErrors.push(classification.raw.slice(0, 200))
    }
  } else {
    map.set(key, {
      category: source,
      description: `${classification.category} failures (patterns: ${classification.matchedPatterns.join(', ') || 'none'})`,
      occurrences: 1,
      taskIds: [taskId],
      sampleErrors: [classification.raw.slice(0, 200)],
    })
  }
}

/** Detect nodes that had retries but eventually succeeded in a completed task */
function detectRetryInstability(taskId: string): string | null {
  const instance = getTaskInstance(taskId)
  if (!instance) return null

  const retriedNodes: string[] = []
  for (const [nodeId, nodeState] of Object.entries(instance.nodeStates ?? {})) {
    if (
      nodeState.status === 'done' &&
      nodeState.attempts !== undefined &&
      nodeState.attempts > 1
    ) {
      retriedNodes.push(`${nodeId}(${nodeState.attempts} attempts)`)
    }
  }

  if (retriedNodes.length === 0) return null
  return `Retried nodes: ${retriedNodes.join(', ')}`
}

/** Classify a single task's failure using workflow/instance data */
function classifyTaskFailure(task: Task): FailureClassification | null {
  const workflow = getTaskWorkflow(task.id)
  const instance = getTaskInstance(task.id)

  if (!workflow || !instance) {
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
