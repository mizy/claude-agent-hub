import { getStore } from '../store/index.js'
import { ui } from '../cli/output.js'
import type { Task, CreateTaskOptions, TaskPriority } from '../types/task.js'

export async function createTask(options: CreateTaskOptions): Promise<Task> {
  const store = getStore()

  const task: Task = {
    id: crypto.randomUUID(),
    title: options.title,
    description: options.description || '',
    priority: (options.priority as TaskPriority) || 'medium',
    status: 'pending',
    assignee: options.assignee,
    createdAt: new Date().toISOString(),
    retryCount: 0
  }

  store.saveTask(task)

  ui.success('任务创建成功')
  const items = [
    { label: 'ID', value: task.id.slice(0, 8), dim: true },
    { label: '标题', value: task.title, dim: true },
    { label: '优先级', value: task.priority, dim: true },
  ]
  if (task.assignee) {
    items.push({ label: '指派给', value: task.assignee, dim: true })
  }
  ui.list(items)

  return task
}
