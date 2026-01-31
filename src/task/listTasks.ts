import chalk from 'chalk'
import { table } from 'table'
import {
  getAllTasks,
  getTasksByStatus,
  getProcessInfo,
  isProcessRunning,
} from '../store/TaskStore.js'

interface ListOptions {
  status?: string
  agent?: string
}

export async function listTasks(options: ListOptions): Promise<void> {
  // Get tasks from new TaskStore
  let tasks = options.status
    ? getTasksByStatus(options.status as import('../types/task.js').TaskStatus)
    : getAllTasks()

  // Filter by agent
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
    failed: chalk.red,
    cancelled: chalk.gray,
  }

  const priorityColors: Record<string, (s: string) => string> = {
    low: chalk.gray,
    medium: chalk.white,
    high: chalk.red,
  }

  const data = [
    ['ID', '标题', '状态', 'PID', '优先级', '创建时间']
  ]

  for (const task of tasks) {
    const statusFn = statusColors[task.status] || chalk.white
    const priorityFn = priorityColors[task.priority] || chalk.white

    // Get process info for running tasks
    let pidDisplay = '-'
    if (task.status === 'planning' || task.status === 'developing') {
      const processInfo = getProcessInfo(task.id)
      if (processInfo) {
        const running = isProcessRunning(processInfo.pid)
        if (running) {
          pidDisplay = chalk.green(String(processInfo.pid))
        } else {
          pidDisplay = chalk.red(`${processInfo.pid} (dead)`)
        }
      }
    }

    // Format ID for display (timestamp-based IDs are longer)
    const idDisplay = task.id.length > 24
      ? task.id.slice(0, 24) + '...'
      : task.id

    data.push([
      idDisplay,
      task.title.slice(0, 25) + (task.title.length > 25 ? '...' : ''),
      statusFn(task.status),
      pidDisplay,
      priorityFn(task.priority),
      task.createdAt.split('T')[0] ?? ''
    ])
  }

  console.log(table(data))
}
