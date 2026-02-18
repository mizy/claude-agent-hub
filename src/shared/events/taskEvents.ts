/**
 * Task lifecycle events — decouples task layer from messaging layer.
 *
 * Task module emits events, messaging module listens.
 * This breaks the task → messaging circular dependency.
 *
 * Listener errors are caught and logged, never propagated to emitter.
 */

import { EventEmitter } from 'events'
import type { Task } from '../../types/task.js'
import { createLogger } from '../logger.js'
import { getErrorMessage } from '../assertError.js'

const logger = createLogger('task-events')

/** Node execution info for notification rendering */
export interface TaskNodeInfo {
  name: string
  status: string
  durationMs?: number
}

export interface TaskCompletionPayload {
  task: Task
  success: boolean
  durationMs: number
  error?: string
  workflowName?: string
  nodesCompleted?: number
  nodesFailed?: number
  totalNodes?: number
  totalCostUsd?: number
  nodes?: TaskNodeInfo[]
}

interface TaskEventMap {
  'task:completed': [payload: TaskCompletionPayload]
}

/**
 * Task event bus with error-isolated listeners.
 * A failing listener will not crash the emitter or block other listeners.
 */
class TaskEventBus extends EventEmitter<TaskEventMap> {
  emit<K extends keyof TaskEventMap>(event: K, ...args: TaskEventMap[K]): boolean {
    const listeners = this.listeners(event)
    for (const listener of listeners) {
      try {
        const result = (listener as (...a: unknown[]) => unknown)(...args)
        // Handle async listeners — catch promise rejections
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          ;(result as Promise<unknown>).catch((e: unknown) => {
            logger.error(`Async listener error for ${String(event)}: ${getErrorMessage(e)}`)
          })
        }
      } catch (e) {
        logger.error(`Listener error for ${String(event)}: ${getErrorMessage(e)}`)
      }
    }
    return listeners.length > 0
  }

  /**
   * Emit event and wait for all async listeners to complete.
   * Use this when the process may exit soon after emitting (e.g. task subprocess).
   */
  async emitAsync<K extends keyof TaskEventMap>(event: K, ...args: TaskEventMap[K]): Promise<void> {
    const listeners = this.listeners(event)
    const promises: Promise<unknown>[] = []
    for (const listener of listeners) {
      try {
        const result = (listener as (...a: unknown[]) => unknown)(...args)
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          promises.push(
            (result as Promise<unknown>).catch((e: unknown) => {
              logger.error(`Async listener error for ${String(event)}: ${getErrorMessage(e)}`)
            })
          )
        }
      } catch (e) {
        logger.error(`Listener error for ${String(event)}: ${getErrorMessage(e)}`)
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises)
    }
  }
}

export const taskEventBus = new TaskEventBus()
