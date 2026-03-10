/**
 * Resume/recovery logic for task execution
 *
 * Handles enqueuing ready nodes when resuming a previously interrupted task.
 */

import { getReadyNodes, enqueueNodes } from '../workflow/index.js'
import { saveInstance } from '../store/WorkflowStore.js'
import { appendExecutionLog } from '../store/TaskLogStore.js'
import { createLogger } from '../shared/logger.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'

const logger = createLogger('task-recovery')

/**
 * Enqueue ready nodes for a resumed workflow execution.
 * Returns the number of nodes enqueued.
 */
export async function enqueueReadyNodesForResume(
  taskId: string,
  workflow: Workflow,
  instance: WorkflowInstance
): Promise<number> {
  let readyNodes = getReadyNodes(workflow, instance)

  // If no ready nodes found, try resetting 'waiting' nodes to 'pending' first.
  // This handles the case where a schedule-wait node was stuck in 'waiting' status
  // after a process crash or orphan recovery.
  if (readyNodes.length === 0) {
    let resetCount = 0
    for (const [nodeId, ns] of Object.entries(instance.nodeStates)) {
      if (ns.status === 'waiting') {
        instance.nodeStates[nodeId] = { ...ns, status: 'pending', error: undefined, startedAt: undefined, completedAt: undefined }
        resetCount++
      }
    }
    if (resetCount > 0) {
      logger.info(`Reset ${resetCount} waiting nodes to pending, retrying ready check`)
      saveInstance(instance)
      readyNodes = getReadyNodes(workflow, instance)
    }
  }

  const statesSummary = Object.entries(instance.nodeStates)
    .map(([id, s]) => `${id}=${s.status}`)
    .join(', ')

  if (readyNodes.length > 0) {
    logger.info(`恢复执行节点: ${readyNodes.join(', ')} (states: ${statesSummary})`)
    appendExecutionLog(taskId, `Enqueuing ready nodes: ${readyNodes.join(', ')}`, {
      scope: 'lifecycle',
    })
    await enqueueNodes(
      readyNodes.map(nodeId => ({
        data: {
          workflowId: workflow.id,
          instanceId: instance.id,
          nodeId,
          attempt: 1,
        },
      }))
    )
  } else {
    logger.warn(`没有可执行的节点: [${statesSummary}]`)
    appendExecutionLog(taskId, `Warning: No ready nodes found. States: ${statesSummary}`, {
      scope: 'lifecycle',
      level: 'warn',
    })
  }

  return readyNodes.length
}
