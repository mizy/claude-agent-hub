import chalk from 'chalk'
import { table } from 'table'
import {
  getAllTasks,
  getTasksByStatus,
  getProcessInfo,
  isProcessRunning,
  getTaskWorkflow,
  getTaskInstance,
} from '../store/TaskStore.js'
import type { Task } from '../types/task.js'

export interface ListOptions {
  status?: string
  agent?: string
  progress?: boolean
  watch?: boolean
  interval?: number
}

interface TaskProgress {
  total: number
  done: number
  running: number
  failed: number
  percent: number
}

/**
 * 计算任务进度
 */
function getTaskProgress(taskId: string): TaskProgress | null {
  const workflow = getTaskWorkflow(taskId)
  const instance = getTaskInstance(taskId)

  if (!workflow || !instance) return null

  // 只计算 task 类型的节点（排除 start/end）
  const taskNodes = workflow.nodes.filter(n => n.type === 'task')
  const total = taskNodes.length

  if (total === 0) return null

  let done = 0
  let running = 0
  let failed = 0

  for (const node of taskNodes) {
    const state = instance.nodeStates[node.id]
    if (state) {
      if (state.status === 'done') done++
      else if (state.status === 'running') running++
      else if (state.status === 'failed') failed++
    }
  }

  const percent = Math.round((done / total) * 100)

  return { total, done, running, failed, percent }
}

/**
 * 格式化进度条
 */
function formatProgressBar(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width)
  const empty = width - filled
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty)

  if (percent === 100) return chalk.green(bar)
  if (percent > 50) return chalk.blue(bar)
  return chalk.gray(bar)
}

/**
 * 渲染任务列表
 */
function renderTaskList(tasks: Task[], showProgress: boolean): void {
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

  const headers = showProgress
    ? ['ID', '标题', '状态', '进度', 'PID', '优先级']
    : ['ID', '标题', '状态', 'PID', '优先级', '创建时间']

  const data: string[][] = [headers]

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

    // Format ID for display
    const idDisplay = task.id.length > 24
      ? task.id.slice(0, 24) + '...'
      : task.id

    // Progress display
    let progressDisplay = '-'
    if (showProgress && (task.status === 'developing' || task.status === 'completed' || task.status === 'failed')) {
      const progress = getTaskProgress(task.id)
      if (progress) {
        const bar = formatProgressBar(progress.percent)
        // 显示进度：已完成/总数，如果有正在运行的也显示
        const runningInfo = progress.running > 0 ? chalk.cyan(` (${progress.running}⏳)`) : ''
        const failedInfo = progress.failed > 0 ? chalk.red(` (${progress.failed}❌)`) : ''
        progressDisplay = `${bar} ${progress.done}/${progress.total}${runningInfo}${failedInfo}`
      }
    }

    if (showProgress) {
      data.push([
        idDisplay,
        task.title.slice(0, 20) + (task.title.length > 20 ? '...' : ''),
        statusFn(task.status),
        progressDisplay,
        pidDisplay,
        priorityFn(task.priority),
      ])
    } else {
      data.push([
        idDisplay,
        task.title.slice(0, 25) + (task.title.length > 25 ? '...' : ''),
        statusFn(task.status),
        pidDisplay,
        priorityFn(task.priority),
        task.createdAt.split('T')[0] ?? ''
      ])
    }
  }

  console.log(table(data))
}

/**
 * 获取过滤后的任务列表
 */
function getFilteredTasks(options: ListOptions): Task[] {
  let tasks = options.status
    ? getTasksByStatus(options.status as import('../types/task.js').TaskStatus)
    : getAllTasks()

  if (options.agent) {
    tasks = tasks.filter(t => t.assignee === options.agent)
  }

  return tasks
}

/**
 * 列出任务
 */
export async function listTasks(options: ListOptions): Promise<void> {
  const showProgress = options.progress ?? true  // 默认显示进度

  if (options.watch) {
    // Watch 模式：持续更新
    const interval = options.interval ?? 2000

    const render = () => {
      console.clear()
      console.log(chalk.cyan(`任务列表 (每 ${interval / 1000}s 更新, Ctrl+C 退出)\n`))
      const tasks = getFilteredTasks(options)
      renderTaskList(tasks, showProgress)
      console.log(chalk.gray(`\n更新时间: ${new Date().toLocaleTimeString()}`))
    }

    render()
    const timer = setInterval(render, interval)

    // 监听退出信号
    process.on('SIGINT', () => {
      clearInterval(timer)
      console.log('\n')
      process.exit(0)
    })

    // 保持进程运行
    await new Promise(() => {})
  } else {
    // 普通模式：显示一次
    const tasks = getFilteredTasks(options)
    renderTaskList(tasks, showProgress)
  }
}
