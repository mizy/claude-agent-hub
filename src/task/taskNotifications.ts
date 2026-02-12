/**
 * Task notification and event emission logic
 *
 * Handles workflow event emission, timeline/jsonl logging,
 * sending completion notifications, and prompt optimization tracking.
 */

import { workflowEvents } from '../workflow/engine/WorkflowEventEmitter.js'
import { appendJsonlLog } from '../store/TaskLogStore.js'
import { appendTimelineEvent, saveExecutionStats } from '../store/ExecutionStatsStore.js'
import { sendTaskCompletionNotify } from './sendTaskNotify.js'
import { extractMemoryFromTask } from '../memory/index.js'
import { analyzeFailure, generateImprovement, recordUsage } from '../prompt-optimization/index.js'
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

  // Send notification
  const taskNodes = workflow.nodes.filter(n => n.type !== 'start' && n.type !== 'end')
  const nodeInfos = taskNodes.map(n => {
    const state = finalInstance.nodeStates[n.id]
    return {
      name: n.name,
      status: state?.status ?? 'pending',
      durationMs: state?.durationMs,
    }
  })
  await sendTaskCompletionNotify(task, success, {
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
 * - On failure: analyzes root cause, generates improvement if prompt-related
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

  // On failure: analyze and potentially generate improvement
  if (!success) {
    const analysis = await analyzeFailure(task, workflow, instance, activeVersion.id)
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
        }
      }
    }
  }
}
