/**
 * Task ID prefix matching — shared by task and query commands
 */

import { createLogger } from '../../shared/logger.js'
import { formatErrorMessage } from '../../shared/formatErrorMessage.js'
import { getAllTasks } from '../../task/index.js'
import type { Task } from '../../types/task.js'
import type { CommandResult } from './types.js'

const logger = createLogger('command-handler')

export function resolveTaskId(
  prefix: string
): { task: Task; error?: never } | { task?: never; error: string } {
  const tasks = getAllTasks()
  const matches = tasks.filter(t => t.id.startsWith(prefix))

  if (matches.length === 0) {
    return { error: `未找到匹配的任务: ${prefix}` }
  }
  if (matches.length > 1) {
    const ids = matches
      .slice(0, 5)
      .map(t => `\`${t.id.slice(0, 20)}\``)
      .join('\n')
    return { error: `匹配到多个任务，请提供更长的前缀:\n${ids}` }
  }
  return { task: matches[0]! }
}

/**
 * Wrap a handler that needs a resolved task.
 * Handles: empty prefix check, task resolution, try/catch with logging.
 */
export async function withResolvedTask(
  taskIdPrefix: string,
  usage: string,
  handler: (task: Task) => Promise<CommandResult>
): Promise<CommandResult> {
  if (!taskIdPrefix.trim()) {
    return { text: usage }
  }

  try {
    const result = resolveTaskId(taskIdPrefix.trim())
    if (result.error) {
      return { text: result.error }
    }
    return await handler(result.task!)
  } catch (error) {
    const msg = formatErrorMessage(error)
    logger.error(`Command failed for ${taskIdPrefix}: ${msg}`)
    return { text: `❌ ${msg}` }
  }
}
