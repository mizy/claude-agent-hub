/**
 * Task notification and event emission logic
 *
 * Handles workflow event emission, timeline/jsonl logging,
 * sending completion notifications, and prompt optimization tracking.
 */

import { workflowEvents } from '../workflow/index.js'
import { appendJsonlLog } from '../store/TaskLogStore.js'
import { appendTimelineEvent, saveExecutionStats } from '../store/ExecutionStatsStore.js'
import { taskEventBus } from '../shared/events/index.js'
import { extractMemoryFromTask } from '../memory/index.js'
import {
  analyzeFailure,
  generateImprovement,
  recordUsage,
  classifyFailure,
  extractFailedNodes,
  createABTest,
  getRunningTest,
  evaluateABTest,
  concludeABTest,
} from '../prompt-optimization/index.js'
import { recordFailure } from '../prompt-optimization/failureKnowledgeBase.js'
import { getActiveVersion } from '../store/PromptVersionStore.js'
import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/index.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'

const logger = createLogger('task-notify')

/**
 * Emit workflow started event + write jsonl log + timeline entry.
 */
export function emitWorkflowStarted(
  task: Task,
  workflow: Workflow,
  instance: WorkflowInstance
): void {
  const taskNodes = workflow.nodes.filter(n => n.type !== 'start' && n.type !== 'end')

  workflowEvents.emitWorkflowStarted({
    workflowId: workflow.id,
    instanceId: instance.id,
    workflowName: workflow.name,
    totalNodes: taskNodes.length,
  })

  appendJsonlLog(task.id, {
    event: 'task_started',
    message: `Task started: ${task.title}`,
    data: {
      workflowId: workflow.id,
      instanceId: instance.id,
      totalNodes: taskNodes.length,
    },
  })

  appendTimelineEvent(task.id, {
    timestamp: new Date().toISOString(),
    event: 'workflow:started',
    instanceId: instance.id,
  })
}

interface CompletionContext {
  workflow: Workflow
  finalInstance: WorkflowInstance
  task: Task
  startedAt: string
  completedAt: string
}

/**
 * Emit workflow completed/failed events, write timeline + jsonl logs,
 * save execution stats, and send completion notification.
 */
export async function emitWorkflowCompleted(ctx: CompletionContext): Promise<void> {
  const { workflow, finalInstance, task, startedAt, completedAt } = ctx
  const totalDurationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  const success = finalInstance.status === 'completed'

  // Execution stats from event emitter
  const executionStats = workflowEvents.getExecutionStats(finalInstance.id)
  const totalCostUsd = executionStats?.summary.totalCostUsd ?? 0
  const nodesCompleted = executionStats?.summary.completedNodes ?? 0
  const nodesFailed = executionStats?.summary.failedNodes ?? 0

  // Emit workflow event
  if (success) {
    workflowEvents.emitWorkflowCompleted({
      workflowId: workflow.id,
      instanceId: finalInstance.id,
      workflowName: workflow.name,
      totalDurationMs,
      nodesCompleted,
      nodesFailed,
      totalCostUsd,
    })
  } else {
    workflowEvents.emitWorkflowFailed({
      workflowId: workflow.id,
      instanceId: finalInstance.id,
      workflowName: workflow.name,
      error: finalInstance.error || 'Unknown error',
      totalDurationMs,
      nodesCompleted,
    })
  }

  // Timeline
  appendTimelineEvent(task.id, {
    timestamp: completedAt,
    event: success ? 'workflow:completed' : 'workflow:failed',
    instanceId: finalInstance.id,
    ...(success ? {} : { details: finalInstance.error }),
  })

  // Jsonl log
  appendJsonlLog(task.id, {
    event: success ? 'task_completed' : 'task_failed',
    message: `Task ${success ? 'completed' : 'failed'}: ${task.title}`,
    durationMs: totalDurationMs,
    ...(success ? {} : { error: finalInstance.error || 'Unknown error' }),
    data: {
      workflowId: workflow.id,
      instanceId: finalInstance.id,
      nodesCompleted,
      ...(success ? { nodesFailed, totalCostUsd } : {}),
    },
  })

  // Save execution stats
  if (executionStats) {
    executionStats.status = finalInstance.status
    executionStats.completedAt = completedAt
    executionStats.totalDurationMs = totalDurationMs
    saveExecutionStats(task.id, executionStats)
  }

  // Emit completion event (messaging layer listens and sends notifications)
  const taskNodes = workflow.nodes.filter(n => n.type !== 'start' && n.type !== 'end')
  const nodeInfos = taskNodes.map(n => {
    const state = finalInstance.nodeStates[n.id]
    return {
      name: n.name,
      status: state?.status ?? 'pending',
      durationMs: state?.durationMs,
    }
  })
  // Use emitAsync to ensure notifications are sent before process exits
  await taskEventBus.emitAsync('task:completed', {
    task,
    success,
    durationMs: totalDurationMs,
    error: finalInstance.error,
    workflowName: workflow.name,
    nodesCompleted,
    nodesFailed,
    totalNodes: Math.max(taskNodes.length, nodesCompleted + nodesFailed),
    totalCostUsd,
    nodes: nodeInfos,
  })

  // Memory extraction (non-blocking)
  extractMemoryFromTask(task, workflow, finalInstance).catch(e =>
    logger.warn(`Memory extraction failed: ${formatErrorMessage(e)}`)
  )

  // Prompt optimization: record usage + analyze failures (non-blocking)
  trackPromptOptimization(task, workflow, finalInstance, success, totalDurationMs).catch(e =>
    logger.warn(`Prompt optimization tracking failed: ${formatErrorMessage(e)}`)
  )
}

/**
 * Track prompt version usage and trigger optimization on failure.
 *
 * - Records success/failure metrics for the active prompt version
 * - On failure: rule-based classify first, then LLM analysis if needed
 * - On failure + improvement generated: auto-create A/B test
 * - On success: check and auto-conclude running A/B tests
 */
async function trackPromptOptimization(
  task: Task,
  workflow: Workflow,
  instance: WorkflowInstance,
  success: boolean,
  durationMs: number
): Promise<void> {
  // Find persona used in this workflow
  const taskNode = workflow.nodes.find(n => n.type === 'task' && n.task?.persona)
  const personaName = taskNode?.task?.persona ?? 'Pragmatist'

  // Get active version for this persona (if any)
  const activeVersion = getActiveVersion(personaName)
  if (!activeVersion) {
    logger.debug(`No active prompt version for ${personaName}, skipping optimization tracking`)
    return
  }

  // Record usage metrics
  recordUsage(personaName, activeVersion.id, success, durationMs)

  if (success) {
    // On success: check if there's a running AB test that can be concluded
    checkAndConcludeABTest(task.id, personaName, instance.id)
    return
  }

  // On failure: rule-based classify first
  const failedNodes = extractFailedNodes(workflow, instance)
  const classification = classifyFailure(failedNodes)

  appendTimelineEvent(task.id, {
    timestamp: new Date().toISOString(),
    event: 'prompt:failure_classified',
    instanceId: instance.id,
    details: `category=${classification.category} confidence=${classification.confidence} patterns=${classification.matchedPatterns.join(',')}`,
  })

  // If high-confidence non-prompt category, skip expensive LLM analysis
  if (classification.category !== 'unknown' && classification.category !== 'prompt' && classification.confidence > 0.8) {
    logger.info(
      `Task ${task.id}: classified as ${classification.category} (confidence=${classification.confidence}), skipping LLM analysis`
    )
    // Record to knowledge base even for non-prompt failures
    recordFailure({
      taskId: task.id,
      personaName,
      versionId: activeVersion.id,
      category: classification.category,
      confidence: classification.confidence,
      matchedPatterns: classification.matchedPatterns,
      failedNodes,
    })
    return
  }

  // LLM analysis for prompt-related or uncertain failures
  const analysis = await analyzeFailure(task, workflow, instance, activeVersion.id)

  // Record to knowledge base with LLM analysis results
  recordFailure({
    taskId: task.id,
    personaName,
    versionId: activeVersion.id,
    category: analysis ? 'prompt' : classification.category,
    confidence: analysis ? 0.9 : classification.confidence,
    matchedPatterns: classification.matchedPatterns,
    failedNodes,
    rootCause: analysis?.rootCause,
    suggestion: analysis?.suggestion,
  })

  if (analysis) {
    logger.info(
      `Prompt-related failure detected for ${personaName}: ${analysis.rootCause}`
    )

    // Check if we should generate an improvement (consecutive failures >= 3)
    if (activeVersion.stats.failureCount >= 2) {
      // stats already updated by recordUsage above, so current failure is the 3rd+
      const improved = await generateImprovement(activeVersion, [analysis])
      if (improved) {
        appendTimelineEvent(task.id, {
          timestamp: new Date().toISOString(),
          event: 'prompt:improvement_generated',
          instanceId: instance.id,
          details: `Generated candidate v${improved.version} for ${personaName}: ${improved.changelog}`,
        })

        // Auto-create A/B test for the new candidate
        try {
          const abTest = createABTest(personaName, improved.id)
          appendTimelineEvent(task.id, {
            timestamp: new Date().toISOString(),
            event: 'prompt:ab_test_created',
            instanceId: instance.id,
            details: `Created A/B test ${abTest.id}: ${abTest.controlVersionId} vs ${abTest.candidateVersionId}`,
          })
        } catch (e) {
          logger.debug(`Auto A/B test creation failed: ${formatErrorMessage(e)}`)
        }
      }
    }
  }
}

/** Check running AB test and auto-conclude if ready */
function checkAndConcludeABTest(taskId: string, personaName: string, instanceId: string): void {
  try {
    const runningTest = getRunningTest(personaName)
    if (!runningTest) return

    const result = evaluateABTest(runningTest.id)
    if (!result) return // not enough samples yet

    concludeABTest(runningTest.id)
    appendTimelineEvent(taskId, {
      timestamp: new Date().toISOString(),
      event: 'prompt:ab_test_concluded',
      instanceId,
      details: `A/B test ${runningTest.id} concluded: winner=${result.winner}`,
    })
  } catch (e) {
    logger.debug(`Auto A/B test conclusion failed: ${formatErrorMessage(e)}`)
  }
}
