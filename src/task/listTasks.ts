import chalk from 'chalk'
import { table } from 'table'
import { getStore } from '../store/index.js'

interface ListOptions {
  status?: string
  agent?: string
}

export async function listTasks(options: ListOptions): Promise<void> {
  const store = getStore()
  let tasks = store.getAllTasks()

  // 筛选
  if (options.status) {
    tasks = tasks.filter(t => t.status === options.status)
  }
  if (options.agent) {
    tasks = tasks.filter(t => t.assignee === options.agent)
  }

  if (tasks.length === 0) {
    console.log(chalk.yellow('暂无任务'))
    return
  }

  const statusColors: Record<string, (s: string) => string> = {
    pending: chalk.gray,
    planning: chalk.cyan,
    developing: chalk.blue,
    reviewing: chalk.yellow,
    completed: chalk.green,
    failed: chalk.red
  }

  const priorityColors: Record<string, (s: string) => string> = {
    low: chalk.gray,
    medium: chalk.white,
    high: chalk.red
  }

  const data = [
    ['ID', '标题', '状态', '优先级', '执行者', '创建时间']
  ]

  for (const task of tasks) {
    const statusFn = statusColors[task.status] || chalk.white
    const priorityFn = priorityColors[task.priority] || chalk.white

    data.push([
      task.id.slice(0, 8),
      task.title.slice(0, 30) + (task.title.length > 30 ? '...' : ''),
      statusFn(task.status),
      priorityFn(task.priority),
      task.assignee || '-',
      task.createdAt.split('T')[0] ?? ''
    ])
  }

  console.log(table(data))
}
