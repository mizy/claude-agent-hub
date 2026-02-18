/**
 * Create task with folder structure
 *
 * 创建任务并生成任务文件夹，不执行
 */

import { createLogger } from '../shared/logger.js'
import { generateTaskId, createTaskFolder, saveTask } from '../store/TaskStore.js'
import { parseTaskPriority } from '../types/task.js'
import { truncateText } from '../shared/truncateText.js'
import type { Task, TaskPriority } from '../types/task.js'

const logger = createLogger('task')

export interface CreateTaskOptions {
  description: string
  /** Override auto-generated title (defaults to truncated description) */
  title?: string
  priority?: TaskPriority | string
  assignee?: string
  backend?: string
  model?: string
  source?: string
  metadata?: Record<string, string>
  /** Override cwd (defaults to process.cwd()) */
  cwd?: string
}

/**
 * Create a task with folder structure
 * Returns the task (does not execute)
 */
export function createTaskWithFolder(options: CreateTaskOptions): Task {
  // Validate priority
  const priority = parseTaskPriority(options.priority)

  const title = options.title ?? truncateText(options.description, 50)

  // Generate timestamp-based ID
  const taskId = generateTaskId(title)

  // Create task folder
  createTaskFolder(taskId)

  // Create task object
  const task: Task = {
    id: taskId,
    title,
    description: options.description,
    priority,
    status: 'pending',
    assignee: options.assignee,
    backend: options.backend,
    model: options.model,
    source: options.source,
    metadata: options.metadata,
    cwd: options.cwd ?? process.cwd(),
    createdAt: new Date().toISOString(),
    retryCount: 0,
  }

  // Save task to folder
  saveTask(task)

  logger.info(`Task created: ${taskId}`)

  return task
}
