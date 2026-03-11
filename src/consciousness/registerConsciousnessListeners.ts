/**
 * Register consciousness listeners for task lifecycle events.
 *
 * Mirrors registerTaskEventListeners.ts pattern — idempotent, error-isolated.
 * Writes task completion/failure events to consciousness.jsonl.
 */

import { taskEventBus, type TaskCompletionPayload } from '../shared/events/index.js'
import { appendEntry } from './consciousnessStore.js'
import { recordEvent } from './innerState.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('consciousness:task-listener')

let registered = false

export function registerConsciousnessListeners(): void {
  if (registered) return
  registered = true

  taskEventBus.on('task:completed', (payload: TaskCompletionPayload) => {
    try {
      const { task, success, durationMs, error } = payload
      const title = task.title || task.description?.slice(0, 50) || 'unknown'
      const durationSec = Math.round(durationMs / 1000)

      let content: string
      if (success) {
        content = `任务完成「${title}」耗时${durationSec}s`
      } else {
        const reason = error ? ` — ${error.slice(0, 80)}` : ''
        content = `任务失败「${title}」耗时${durationSec}s${reason}`
      }

      appendEntry({
        ts: new Date().toISOString(),
        type: 'task_event',
        content,
        metadata: {
          taskId: task.id,
          taskTitle: title,
          duration: durationMs,
        },
      })

      recordEvent(success ? 'task_done' : 'task_fail', content)
    } catch (e) {
      logger.warn(`Failed to write consciousness task event: ${getErrorMessage(e)}`)
    }
  })
}
