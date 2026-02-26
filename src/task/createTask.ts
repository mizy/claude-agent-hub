import { createTaskWithFolder } from './createTaskWithFolder.js'
import type { Task, CreateTaskOptions } from '../types/task.js'

/**
 * Create a task (delegates to createTaskWithFolder for consistent ID generation and folder structure)
 * Kept async for backward compatibility with existing callers.
 */
export function createTask(options: CreateTaskOptions): Task {
  return createTaskWithFolder({
    description: options.description || '',
    title: options.title,
    priority: options.priority,
    assignee: options.assignee,
    backend: options.backend,
    model: options.model,
    source: options.source,
    schedule: options.schedule,
  })
}
