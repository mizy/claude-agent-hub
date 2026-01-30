import chalk from 'chalk'
import { getStore } from '../store/index.js'
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

  console.log(chalk.green(`✓ 任务创建成功`))
  console.log(chalk.gray(`  ID: ${task.id.slice(0, 8)}`))
  console.log(chalk.gray(`  标题: ${task.title}`))
  console.log(chalk.gray(`  优先级: ${task.priority}`))

  if (task.assignee) {
    console.log(chalk.gray(`  指派给: ${task.assignee}`))
  }

  return task
}
