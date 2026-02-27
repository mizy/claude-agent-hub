/**
 * Task display/formatting logic — CLI-oriented output
 */

import chalk from 'chalk'
import { table } from 'table'
import { existsSync } from 'fs'
import { CronExpressionParser } from 'cron-parser'
import {
  getTask,
  getProcessInfo,
  isProcessRunning,
  getTaskFolder,
} from '../store/TaskStore.js'
import {
  getTaskWorkflow,
  getTaskInstance,
  getWorkflowPath,
  getInstancePath,
} from '../store/TaskWorkflowStore.js'
import { getLogPath, getOutputPath } from '../store/TaskLogStore.js'
import type { Task } from '../types/task.js'

// ============ Progress ============

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
export function renderTaskList(tasks: Task[], showProgress: boolean): void {
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
    waiting: chalk.yellow,
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
    const schedulePrefix = task.scheduleCron ? '[⏰] ' : ''

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

    // Show "waiting (cron)" for scheduled tasks in waiting status
    const statusDisplay =
      task.status === 'waiting' && task.scheduleCron
        ? statusFn('waiting (cron)')
        : statusFn(task.status)

    if (showProgress) {
      const rawTitle = task.title
        ? schedulePrefix + task.title
        : ''
      const titleDisplay = rawTitle
        ? rawTitle.slice(0, 20) + (rawTitle.length > 20 ? '...' : '')
        : chalk.gray('(无标题)')
      data.push([
        idDisplay,
        titleDisplay,
        statusDisplay,
        progressDisplay,
        pidDisplay,
        priorityFn(task.priority),
      ])
    } else {
      const rawTitle = task.title
        ? schedulePrefix + task.title
        : ''
      const titleDisplay = rawTitle
        ? rawTitle.slice(0, 25) + (rawTitle.length > 25 ? '...' : '')
        : chalk.gray('(无标题)')
      data.push([
        idDisplay,
        titleDisplay,
        statusDisplay,
        pidDisplay,
        priorityFn(task.priority),
        task.createdAt.split('T')[0] ?? '',
      ])
    }
  }

  console.log(table(data))
}

// ============ Task Detail ============

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
    waiting: chalk.yellow,
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
  if (task.scheduleCron) {
    let nextRun = ''
    try {
      const interval = CronExpressionParser.parse(task.scheduleCron, { tz: 'Asia/Shanghai' })
      nextRun = ` (next: ${interval.next().toISOString()})`
    } catch {
      // ignore parse errors
    }
    console.log(`${chalk.gray('Schedule:')} ${chalk.cyan(task.scheduleCron)}${nextRun}`)
  }
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
