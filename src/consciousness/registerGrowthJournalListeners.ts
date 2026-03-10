/**
 * Register growth journal listeners for task lifecycle events.
 *
 * Records task completions as growth entries when they represent
 * meaningful changes (selfevolve tasks, feature tasks, etc.)
 */

import { taskEventBus, type TaskCompletionPayload } from '../shared/events/index.js'
import { recordGrowth, type GrowthChangeType, type GrowthJournalEntry } from './growthJournal.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('consciousness:growth-listener')

let registered = false

/** Infer change type from task metadata and description */
function inferChangeType(task: TaskCompletionPayload['task']): GrowthChangeType | null {
  const desc = (task.description || '').toLowerCase()
  const source = task.metadata?.source as string | undefined
  const goalType = task.metadata?.goalType as string | undefined

  // selfevolve tasks
  if (source === 'selfevolve' || goalType === 'evolve' || goalType === 'evolve-feature') {
    return 'evolution'
  }

  // Infer from description keywords
  if (desc.includes('fix') || desc.includes('修复') || desc.includes('bug')) return 'fix'
  if (desc.includes('refactor') || desc.includes('重构')) return 'refactor'
  if (desc.includes('优化') || desc.includes('optimi')) return 'optimization'
  if (desc.includes('feat') || desc.includes('新增') || desc.includes('实现') || desc.includes('添加')) return 'feature'

  return null
}

export function registerGrowthJournalListeners(): void {
  if (registered) return
  registered = true

  taskEventBus.on('task:completed', (payload: TaskCompletionPayload) => {
    try {
      const { task, success, durationMs } = payload
      if (!success) return // only record successful completions

      const changeType = inferChangeType(task)
      if (!changeType) return // skip tasks that don't represent growth

      const title = task.title || task.description?.slice(0, 80) || 'unknown'

      const entry: GrowthJournalEntry = {
        id: `growth-${Date.now()}`,
        date: new Date().toISOString(),
        changeType,
        description: title,
        filesChanged: [],
        taskId: task.id,
        source: (task.metadata?.source as string) || 'task',
      }

      // Mark milestone for evolution tasks
      if (changeType === 'evolution') {
        entry.milestone = `Self-evolution: ${title}`
      }

      // Attach duration as a simple metric
      entry.afterMetrics = { avgTaskDurationMs: durationMs }

      recordGrowth(entry)
    } catch (e) {
      logger.warn(`Failed to record growth event: ${getErrorMessage(e)}`)
    }
  })
}
