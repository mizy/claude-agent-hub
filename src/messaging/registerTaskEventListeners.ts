/**
 * Register messaging listeners for task lifecycle events.
 *
 * Called during daemon startup to bridge task events → notifications.
 * This keeps the dependency direction: messaging → task events (via shared),
 * without task importing messaging.
 */

import { taskEventBus, type TaskCompletionPayload } from '../shared/events/index.js'
import { sendTaskCompletionNotify } from './sendTaskNotify.js'
import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'

const logger = createLogger('task-event-listener')

let registered = false

export function registerTaskEventListeners(): void {
  if (registered) return
  registered = true

  taskEventBus.on('task:completed', async (payload: TaskCompletionPayload) => {
    try {
      await sendTaskCompletionNotify(payload.task, payload.success, {
        durationMs: payload.durationMs,
        error: payload.error,
        workflowName: payload.workflowName,
        nodesCompleted: payload.nodesCompleted,
        nodesFailed: payload.nodesFailed,
        totalNodes: payload.totalNodes,
        totalCostUsd: payload.totalCostUsd,
        nodes: payload.nodes,
      })
    } catch (error) {
      logger.warn(`Failed to send task completion notification: ${formatErrorMessage(error)}`)
    }
  })
}
