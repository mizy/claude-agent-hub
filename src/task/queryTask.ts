/**
 * Task query operations: list, get detail, poll
 */

import chalk from 'chalk'
import { table } from 'table'
import { existsSync } from 'fs'
import {
  getAllTasks,
  getTasksByStatus,
  getTask,
  getProcessInfo,
  isProcessRunning,
  getTaskFolder,
} from '../store/TaskStore.js'
import { getStore } from '../store/index.js'
import {
  getTaskWorkflow,
  getTaskInstance,
  getWorkflowPath,
  getInstancePath,
} from '../store/TaskWorkflowStore.js'
import { getLogPath, getOutputPath } from '../store/TaskLogStore.js'
import type { Task } from '../types/task.js'
import { parseTaskStatus } from '../types/task.js'

// ============ List Tasks ============

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
    console.warn(chalk.yellow('!'), '暂无任务')
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
    const idDisplay = task.id.length > 24 ? task.id.slice(0, 24) + '...' : task.id

    // Progress display
    let progressDisplay = '-'
    if (
      showProgress &&
      (task.status === 'developing' || task.status === 'completed' || task.status === 'failed')
    ) {
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
      const titleDisplay = task.title
        ? task.title.slice(0, 20) + (task.title.length > 20 ? '...' : '')
        : chalk.gray('(无标题)')
      data.push([
        idDisplay,
        titleDisplay,
        statusFn(task.status),
        progressDisplay,
        pidDisplay,
        priorityFn(task.priority),
      ])
    } else {
      const titleDisplay = task.title
        ? task.title.slice(0, 25) + (task.title.length > 25 ? '...' : '')
        : chalk.gray('(无标题)')
      data.push([
        idDisplay,
        titleDisplay,
        statusFn(task.status),
        pidDisplay,
        priorityFn(task.priority),
        task.createdAt.split('T')[0] ?? '',
      ])
    }
  }

  console.log(table(data))
}

/**
 * 获取过滤后的任务列表
 */
function getFilteredTasks(options: ListOptions): Task[] {
  const status = options.status ? parseTaskStatus(options.status) : null
  let tasks = status ? getTasksByStatus(status) : getAllTasks()

  if (options.agent) {
    tasks = tasks.filter(t => t.assignee === options.agent)
  }

  return tasks
}

/**
 * 列出任务
 */
export async function listTasks(options: ListOptions): Promise<void> {
  const showProgress = options.progress ?? true // 默认显示进度

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

// ============ Get Task Detail ============

/**
 * Format status with color
 */
function formatStatus(status: string): string {
  const colors: Record<string, (s: string) => string> = {
    pending: chalk.gray,
    planning: chalk.yellow,
    developing: chalk.blue,
    reviewing: chalk.cyan,
    completed: chalk.green,
    failed: chalk.red,
  }
  return (colors[status] || chalk.white)(status)
}

/**
 * Format process status with color
 */
function formatProcessStatus(status: string, isAlive: boolean): string {
  if (status === 'running') {
    return isAlive ? chalk.green('running') : chalk.red('dead')
  }
  if (status === 'stopped') {
    return chalk.gray('stopped')
  }
  if (status === 'crashed') {
    return chalk.red('crashed')
  }
  return chalk.gray(status)
}

export interface GetTaskDetailOptions {
  json?: boolean
  verbose?: boolean
}

export async function getTaskDetail(id: string, options: GetTaskDetailOptions = {}): Promise<void> {
  const task = getTask(id)

  if (!task) {
    if (options.json) {
      console.log(JSON.stringify({ error: `Task "${id}" not found` }))
    } else {
      console.error(chalk.red('✗'), `Task "${id}" not found`)
    }
    return
  }

  // JSON 输出模式
  if (options.json) {
    const result: Record<string, unknown> = { task }

    const processInfo = getProcessInfo(task.id)
    if (processInfo) {
      const isAlive = processInfo.status === 'running' && isProcessRunning(processInfo.pid)
      result.process = { ...processInfo, isAlive }
    }

    if (options.verbose) {
      const workflow = getTaskWorkflow(task.id)
      const instance = getTaskInstance(task.id)
      if (workflow) result.workflow = workflow
      if (instance) result.instance = instance
    }

    console.log(JSON.stringify(result, null, 2))
    return
  }

  // Header
  console.log(chalk.bold(`Task: ${task.title}`))
  console.log(chalk.gray('─'.repeat(60)))

  // Basic info
  console.log(`${chalk.gray('ID:')}       ${task.id}`)
  console.log(`${chalk.gray('Status:')}   ${formatStatus(task.status)}`)
  console.log(`${chalk.gray('Priority:')} ${task.priority}`)
  console.log(`${chalk.gray('Assignee:')} ${task.assignee || chalk.gray('(not assigned)')}`)
  console.log(`${chalk.gray('Created:')}  ${task.createdAt}`)

  // Process info
  const processInfo = getProcessInfo(task.id)
  if (processInfo) {
    console.log('')
    console.log(chalk.bold('Process:'))
    const isAlive = processInfo.status === 'running' && isProcessRunning(processInfo.pid)
    console.log(`  ${chalk.gray('PID:')}    ${processInfo.pid}`)
    console.log(`  ${chalk.gray('Status:')} ${formatProcessStatus(processInfo.status, isAlive)}`)
    console.log(`  ${chalk.gray('Started:')} ${processInfo.startedAt}`)
    if (processInfo.lastHeartbeat) {
      console.log(`  ${chalk.gray('Last heartbeat:')} ${processInfo.lastHeartbeat}`)
    }
    if (processInfo.error) {
      console.log(`  ${chalk.gray('Error:')} ${chalk.red(processInfo.error)}`)
    }
  }

  // Verbose: Node status
  if (options.verbose) {
    const workflow = getTaskWorkflow(task.id)
    const instance = getTaskInstance(task.id)

    if (workflow && instance) {
      console.log('')
      console.log(chalk.bold('Nodes:'))

      for (const node of workflow.nodes) {
        if (node.type === 'start' || node.type === 'end') continue

        const state = instance.nodeStates[node.id]
        const statusIcon =
          state?.status === 'done'
            ? chalk.green('✓')
            : state?.status === 'failed'
              ? chalk.red('✗')
              : state?.status === 'running'
                ? chalk.cyan('⏳')
                : chalk.gray('○')

        const durationStr = state?.durationMs
          ? chalk.gray(` (${Math.round(state.durationMs / 1000)}s)`)
          : ''
        console.log(`  ${statusIcon} ${node.name}${durationStr}`)

        if (state?.error) {
          console.log(chalk.red(`      Error: ${state.error}`))
        }
      }
    }
  }

  // Description
  if (task.description) {
    console.log('')
    console.log(chalk.bold('Description:'))
    console.log(task.description)
  }

  // File paths
  const taskFolder = getTaskFolder(task.id)
  if (taskFolder && existsSync(taskFolder)) {
    console.log('')
    console.log(chalk.bold('Files:'))
    console.log(`  ${chalk.gray('Folder:')} ${taskFolder}`)

    const workflowPath = getWorkflowPath(task.id)
    if (existsSync(workflowPath)) {
      console.log(`  ${chalk.gray('Workflow:')} ${workflowPath}`)
    }

    const instancePath = getInstancePath(task.id)
    if (existsSync(instancePath)) {
      console.log(`  ${chalk.gray('Instance:')} ${instancePath}`)
    }

    const logPath = getLogPath(task.id)
    if (existsSync(logPath)) {
      console.log(`  ${chalk.gray('Log:')} ${logPath}`)
    }

    const outputPath = getOutputPath(task.id)
    if (existsSync(outputPath)) {
      console.log(`  ${chalk.gray('Output:')} ${chalk.green(outputPath)}`)
    }
  }

  // Branch info (legacy)
  if (task.branch) {
    console.log('')
    console.log(`${chalk.gray('Branch:')} ${task.branch}`)
  }
}

// ============ Poll Task ============

/**
 * 轮询获取下一个待处理任务
 * 优先级顺序: high > medium > low
 * 同优先级按创建时间排序
 */
export async function pollPendingTask(): Promise<Task | null> {
  const store = getStore()
  const tasks = store.getAllTasks()

  // 筛选待处理任务
  const pendingTasks = tasks.filter(t => t.status === 'pending')

  if (pendingTasks.length === 0) {
    return null
  }

  // 按优先级和时间排序
  const priorityOrder = { high: 0, medium: 1, low: 2 }

  pendingTasks.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 1
    const pb = priorityOrder[b.priority] ?? 1

    if (pa !== pb) return pa - pb

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  return pendingTasks[0] ?? null
}

// Re-export getAllTasks for external use
export { getAllTasks }
