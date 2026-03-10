/**
 * Register selfdrive listeners for task lifecycle events.
 *
 * Updates goal run status (success/failure) when a selfdrive task completes,
 * instead of marking success immediately at task creation time.
 */

import { taskEventBus, type TaskCompletionPayload } from '../shared/events/index.js'
import { markGoalRun } from './goals.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('selfdrive-listener')

let registered = false

export function registerSelfdriveListeners(): void {
  if (registered) return
  registered = true

  taskEventBus.on('task:completed', (payload: TaskCompletionPayload) => {
    const goalId = payload.task.metadata?.goalId as string | undefined
    if (!goalId) return

    try {
      const result = payload.success ? 'success' : 'failure'
      const error = payload.success ? undefined : payload.error
      logger.info(`Goal ${goalId} task ${payload.task.id} ${result}`)
      markGoalRun(goalId, result, error)
    } catch (err) {
      logger.error(`Failed to mark goal ${goalId} run: ${err}`)
    }
  })
}
