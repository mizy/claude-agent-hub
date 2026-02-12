/**
 * Resume/recovery logic for task execution
 *
 * Handles enqueuing ready nodes when resuming a previously interrupted task.
 */

import { getReadyNodes } from '../workflow/engine/WorkflowEngine.js'
import { enqueueNodes } from '../workflow/index.js'
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
  const readyNodes = getReadyNodes(workflow, instance)

  if (readyNodes.length > 0) {
    logger.info(`恢复执行节点: ${readyNodes.join(', ')}`)
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
    logger.warn(`没有可执行的节点`)
    appendExecutionLog(taskId, `Warning: No ready nodes found`, {
      scope: 'lifecycle',
      level: 'warn',
    })
  }

  return readyNodes.length
}
