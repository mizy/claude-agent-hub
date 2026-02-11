/**
 * Task notification and event emission logic
 *
 * Handles workflow event emission, timeline/jsonl logging,
 * and sending completion notifications.
 */

import { workflowEvents } from '../workflow/engine/WorkflowEventEmitter.js'
import { appendJsonlLog } from '../store/TaskLogStore.js'
import { appendTimelineEvent, saveExecutionStats } from '../store/ExecutionStatsStore.js'
import { sendTaskCompletionNotify } from './sendTaskNotify.js'
import { extractMemoryFromTask } from '../memory/index.js'
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
}
