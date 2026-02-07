import { getStore } from '../store/index.js'
import { parseTaskPriority } from '../types/task.js'
import type { Task, CreateTaskOptions } from '../types/task.js'

export async function createTask(options: CreateTaskOptions): Promise<Task> {
  const store = getStore()

  const task: Task = {
    id: crypto.randomUUID(),
    title: options.title,
    description: options.description || '',
    priority: parseTaskPriority(options.priority),
    status: 'pending',
    assignee: options.assignee,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  }

  store.saveTask(task)

  return task
}
