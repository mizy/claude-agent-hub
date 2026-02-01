/**
 * 实时任务摘要
 * 显示当前运行的任务状态和今日统计
 */

import { readdirSync, existsSync, readFileSync } from 'fs'
import { TASKS_DIR } from '../store/paths.js'
import { readJson } from '../store/json.js'
import { formatDuration } from '../store/ExecutionStatsStore.js'
import { estimateRemainingTime } from '../agent/timeEstimator.js'
import chalk from 'chalk'
import type { Task } from '../types/task.js'
import type { WorkflowInstance } from '../workflow/types.js'
import type { ExecutionSummary } from '../store/ExecutionStatsStore.js'

// ============ 类型定义 ============

export interface RunningTaskInfo {
  taskId: string
  title: string
  status: string
  currentNode: string | null
  progress: {
    completed: number
    total: number
    percentage: number
  }
  startedAt: Date
  elapsedMs: number
  /** 预估剩余时间（毫秒） */
  estimatedRemainingMs?: number
  /** 预估置信度 (0-1) */
  estimateConfidence?: number
}

/** 待执行任务队列项 */
export interface QueuedTaskInfo {
  taskId: string
  title: string
  status: string
  createdAt: Date
  /** 预估执行时间（毫秒） */
  estimatedDurationMs?: number
}

export interface TodaySummary {
  date: string
  tasksCreated: number
  tasksCompleted: number
  tasksFailed: number
  tasksRunning: number
  totalDurationMs: number
  totalCostUsd: number
  avgSuccessRate: number
}

export interface LiveSummaryReport {
  generatedAt: string
  runningTasks: RunningTaskInfo[]
  /** 待执行任务队列 */
  queuedTasks: QueuedTaskInfo[]
  todaySummary: TodaySummary
  recentCompleted: Array<{
    taskId: string
    title: string
    status: string
    durationMs: number
    completedAt: string
  }>
  /** 预估全部任务完成时间 */
  estimatedAllCompletionTime?: string
}

// ============ 数据收集 ============

/**
 * 获取运行中的任务
 */
function getRunningTasks(): RunningTaskInfo[] {
  if (!existsSync(TASKS_DIR)) {
    return []
  }

  const taskFolders = readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('task-'))
    .map(d => d.name)

  const running: RunningTaskInfo[] = []

  for (const folder of taskFolders) {
    const taskPath = `${TASKS_DIR}/${folder}`
    const taskJsonPath = `${taskPath}/task.json`
    const instancePath = `${taskPath}/instance.json`
    const workflowPath = `${taskPath}/workflow.json`

    if (!existsSync(taskJsonPath)) continue

    const task = readJson<Task>(taskJsonPath, { defaultValue: null })
    if (!task) continue

    // 检查是否在运行中 (developing/planning 是运行状态)
    const runningStatuses: string[] = ['developing', 'planning']
    if (!runningStatuses.includes(task.status)) {
      continue
    }

    // 读取实例数据获取进度
    const instance = existsSync(instancePath)
      ? readJson<WorkflowInstance>(instancePath, { defaultValue: null })
      : null

    let currentNode: string | null = null
    let completed = 0
    let total = 0

    // 收集节点状态用于时间预估
    const nodeStatesForEstimate: Array<{
      name: string
      type: string
      status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
      durationMs?: number
      startedAt?: string
    }> = []

    // 读取 workflow 获取节点名称
    let workflowNodes: Array<{ id: string; name: string; type: string }> = []
    if (existsSync(workflowPath)) {
      try {
        const workflow = JSON.parse(readFileSync(workflowPath, 'utf-8'))
        workflowNodes = workflow.nodes || []
      } catch {
        // ignore
      }
    }

    if (instance?.nodeStates) {
      const states = Object.entries(instance.nodeStates)
      total = states.filter(([_, s]) => s.status !== 'pending' || s.attempts > 0).length

      for (const [nodeId, state] of states) {
        if (state.status === 'done') completed++
        if (state.status === 'running') currentNode = nodeId

        // 构建节点状态用于时间预估
        const workflowNode = workflowNodes.find(n => n.id === nodeId)
        nodeStatesForEstimate.push({
          name: workflowNode?.name || nodeId,
          type: workflowNode?.type || 'task',
          status: state.status === 'done' ? 'completed' : state.status as 'pending' | 'running' | 'failed' | 'skipped',
          durationMs: state.durationMs,
          startedAt: state.startedAt,
        })
      }
    }

    const startedAt = instance?.startedAt ? new Date(instance.startedAt) : new Date(task.createdAt)
    const elapsedMs = Date.now() - startedAt.getTime()

    // 计算时间预估
    let estimatedRemainingMs: number | undefined
    let estimateConfidence: number | undefined
    if (nodeStatesForEstimate.length > 0) {
      const estimate = estimateRemainingTime(nodeStatesForEstimate, elapsedMs)
      estimatedRemainingMs = estimate.remainingMs
      estimateConfidence = estimate.confidence
    }

    running.push({
      taskId: task.id,
      title: task.title,
      status: task.status,
      currentNode,
      progress: {
        completed,
        total: total || 1,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
      startedAt,
      elapsedMs,
      estimatedRemainingMs,
      estimateConfidence,
    })
  }

  return running.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
}

/**
 * 获取待执行任务队列
 */
function getQueuedTasks(): QueuedTaskInfo[] {
  if (!existsSync(TASKS_DIR)) {
    return []
  }

  const taskFolders = readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('task-'))
    .map(d => d.name)

  const queued: QueuedTaskInfo[] = []

  for (const folder of taskFolders) {
    const taskPath = `${TASKS_DIR}/${folder}`
    const taskJsonPath = `${taskPath}/task.json`

    if (!existsSync(taskJsonPath)) continue

    const task = readJson<Task>(taskJsonPath, { defaultValue: null })
    if (!task) continue

    // 检查是否是待执行状态 (created/pending)
    const queuedStatuses: string[] = ['created', 'pending']
    if (!queuedStatuses.includes(task.status)) {
      continue
    }

    queued.push({
      taskId: task.id,
      title: task.title,
      status: task.status,
      createdAt: new Date(task.createdAt),
      // 预估执行时间基于历史平均值（简化处理）
      estimatedDurationMs: 180000, // 默认 3 分钟
    })
  }

  return queued.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

/**
 * 获取今日统计
 */
function getTodaySummary(): TodaySummary {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // 使用本地时区日期格式（与 toISOString().slice(0, 10) 可能因时区差异不同）
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}-${day}`

  const summary: TodaySummary = {
    date: dateStr,
    tasksCreated: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    tasksRunning: 0,
    totalDurationMs: 0,
    totalCostUsd: 0,
    avgSuccessRate: 0,
  }

  if (!existsSync(TASKS_DIR)) {
    return summary
  }

  const taskFolders = readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('task-'))
    .map(d => d.name)

  for (const folder of taskFolders) {
    const taskPath = `${TASKS_DIR}/${folder}`
    const taskJsonPath = `${taskPath}/task.json`
    const statsPath = `${taskPath}/stats.json`

    if (!existsSync(taskJsonPath)) continue

    const task = readJson<Task>(taskJsonPath, { defaultValue: null })
    if (!task) continue

    const createdAt = new Date(task.createdAt)
    createdAt.setHours(0, 0, 0, 0)

    if (createdAt.getTime() !== today.getTime()) continue

    summary.tasksCreated++

    if (task.status === 'completed') {
      summary.tasksCompleted++
    } else if (task.status === 'failed') {
      summary.tasksFailed++
    } else if (task.status === 'developing' || task.status === 'planning') {
      summary.tasksRunning++
    }

    // 读取统计数据
    if (existsSync(statsPath)) {
      const stats = readJson<{ summary: ExecutionSummary }>(statsPath, { defaultValue: null })
      if (stats?.summary) {
        summary.totalDurationMs += stats.summary.totalDurationMs
        summary.totalCostUsd += stats.summary.totalCostUsd
      }
    }
  }

  summary.avgSuccessRate = summary.tasksCreated > 0
    ? Math.round(((summary.tasksCompleted) / (summary.tasksCompleted + summary.tasksFailed || 1)) * 100)
    : 0

  return summary
}

/**
 * 获取最近完成的任务
 */
function getRecentCompleted(limit: number = 5): LiveSummaryReport['recentCompleted'] {
  if (!existsSync(TASKS_DIR)) {
    return []
  }

  const taskFolders = readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('task-'))
    .map(d => d.name)

  const completed: Array<{
    taskId: string
    title: string
    status: string
    durationMs: number
    completedAt: Date
  }> = []

  for (const folder of taskFolders) {
    const taskPath = `${TASKS_DIR}/${folder}`
    const taskJsonPath = `${taskPath}/task.json`
    const instancePath = `${taskPath}/instance.json`

    if (!existsSync(taskJsonPath)) continue

    const task = readJson<Task>(taskJsonPath, { defaultValue: null })
    if (!task) continue

    if (task.status !== 'completed' && task.status !== 'failed') continue

    const instance = existsSync(instancePath)
      ? readJson<WorkflowInstance>(instancePath, { defaultValue: null })
      : null

    const completedAt = instance?.completedAt
      ? new Date(instance.completedAt)
      : new Date(task.updatedAt || task.createdAt)

    const startedAt = instance?.startedAt
      ? new Date(instance.startedAt)
      : new Date(task.createdAt)

    completed.push({
      taskId: task.id,
      title: task.title,
      status: task.status,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      completedAt,
    })
  }

  return completed
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
    .slice(0, limit)
    .map(t => ({
      ...t,
      completedAt: t.completedAt.toISOString(),
    }))
}

// ============ 公开 API ============

/**
 * 生成实时摘要报告
 */
export function generateLiveSummary(): LiveSummaryReport {
  const runningTasks = getRunningTasks()
  const queuedTasks = getQueuedTasks()

  // 计算全部任务预估完成时间
  let estimatedAllCompletionTime: string | undefined
  const totalRemainingMs =
    runningTasks.reduce((sum, t) => sum + (t.estimatedRemainingMs || 60000), 0) +
    queuedTasks.reduce((sum, t) => sum + (t.estimatedDurationMs || 180000), 0)

  if (runningTasks.length > 0 || queuedTasks.length > 0) {
    const estimatedCompletion = new Date(Date.now() + totalRemainingMs)
    estimatedAllCompletionTime = estimatedCompletion.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    runningTasks,
    queuedTasks,
    todaySummary: getTodaySummary(),
    recentCompleted: getRecentCompleted(),
    estimatedAllCompletionTime,
  }
}

// ============ 格式化输出 ============

/**
 * 格式化实时摘要为终端输出
 */
export function formatLiveSummaryForTerminal(report: LiveSummaryReport): string {
  const lines: string[] = []

  lines.push('')
  lines.push(chalk.cyan.bold('  📊 CAH 实时状态'))
  lines.push(chalk.dim('  ' + '─'.repeat(50)))
  lines.push('')

  // 运行中的任务
  if (report.runningTasks.length > 0) {
    lines.push(chalk.yellow.bold('  🔄 运行中的任务'))
    lines.push('')
    for (const task of report.runningTasks) {
      const progressBar = createProgressBar(task.progress.percentage, 20)
      const elapsed = formatDuration(task.elapsedMs)
      const title = task.title.length > 30 ? task.title.slice(0, 27) + '...' : task.title

      // 预估剩余时间
      let etaStr = ''
      if (task.estimatedRemainingMs !== undefined && task.estimatedRemainingMs > 0) {
        const confidencePrefix = task.estimateConfidence !== undefined
          ? (task.estimateConfidence >= 0.7 ? '' : task.estimateConfidence >= 0.4 ? '~' : '≈')
          : '≈'
        etaStr = chalk.cyan(` ETA: ${confidencePrefix}${formatDuration(task.estimatedRemainingMs)}`)
      }

      lines.push(`    ${chalk.white(title)}`)
      lines.push(`    ${progressBar} ${task.progress.completed}/${task.progress.total} (${elapsed})${etaStr}`)
      if (task.currentNode) {
        lines.push(chalk.dim(`    当前节点: ${task.currentNode}`))
      }
      lines.push('')
    }
  } else {
    lines.push(chalk.dim('  当前没有运行中的任务'))
    lines.push('')
  }

  // 待执行任务队列
  if (report.queuedTasks.length > 0) {
    lines.push(chalk.blue.bold('  📋 待执行队列'))
    lines.push('')
    for (const task of report.queuedTasks.slice(0, 5)) {
      const title = task.title.length > 40 ? task.title.slice(0, 37) + '...' : task.title
      const waiting = formatDuration(Date.now() - task.createdAt.getTime())
      lines.push(`    • ${title}  ${chalk.dim(`等待 ${waiting}`)}`)
    }
    if (report.queuedTasks.length > 5) {
      lines.push(chalk.dim(`    ... 还有 ${report.queuedTasks.length - 5} 个任务`))
    }
    lines.push('')
  }

  // 预估全部完成时间
  if (report.estimatedAllCompletionTime && (report.runningTasks.length > 0 || report.queuedTasks.length > 0)) {
    lines.push(chalk.cyan(`  ⏰ 预计全部完成: ${report.estimatedAllCompletionTime}`))
    lines.push('')
  }

  // 今日统计
  lines.push(chalk.cyan.bold('  📈 今日统计'))
  lines.push('')

  const s = report.todaySummary
  const stats = [
    `创建: ${s.tasksCreated}`,
    chalk.green(`完成: ${s.tasksCompleted}`),
    s.tasksFailed > 0 ? chalk.red(`失败: ${s.tasksFailed}`) : `失败: ${s.tasksFailed}`,
    s.tasksRunning > 0 ? chalk.yellow(`运行: ${s.tasksRunning}`) : `运行: ${s.tasksRunning}`,
  ]

  lines.push(`    ${stats.join('  |  ')}`)
  lines.push('')

  if (s.totalDurationMs > 0 || s.totalCostUsd > 0) {
    lines.push(chalk.dim(`    总耗时: ${formatDuration(s.totalDurationMs)}  |  总成本: $${s.totalCostUsd.toFixed(4)}`))
    lines.push('')
  }

  // 最近完成的任务
  if (report.recentCompleted.length > 0) {
    lines.push(chalk.cyan.bold('  📋 最近完成'))
    lines.push('')
    for (const task of report.recentCompleted) {
      const icon = task.status === 'completed' ? chalk.green('✓') : chalk.red('✗')
      const title = task.title.length > 35 ? task.title.slice(0, 32) + '...' : task.title
      const time = new Date(task.completedAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      lines.push(`    ${icon} ${title}  ${chalk.dim(time)}`)
    }
    lines.push('')
  }

  lines.push(chalk.dim('  ' + '─'.repeat(50)))
  lines.push('')

  return lines.join('\n')
}

/**
 * 创建进度条
 */
function createProgressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width)
  const empty = width - filled
  const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty))
  return `[${bar}] ${percentage}%`
}

/**
 * 格式化实时摘要为 JSON
 */
export function formatLiveSummaryForJson(report: LiveSummaryReport): string {
  return JSON.stringify(report, null, 2)
}
