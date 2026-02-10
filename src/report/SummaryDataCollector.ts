/**
 * 实时摘要数据收集器
 * 收集运行中任务、待执行队列、今日统计、最近完成任务等信息
 */

import { readdirSync, existsSync, readFileSync } from 'fs'
import { TASKS_DIR } from '../store/paths.js'
import { readJson } from '../store/readWriteJson.js'
import { estimateRemainingTime } from '../analysis/estimateTime.js'
import type { Task } from '../types/task.js'
import type { WorkflowInstance } from '../workflow/types.js'
import type { ExecutionSummary } from '../task/index.js'
import type {
  RunningTaskInfo,
  QueuedTaskInfo,
  TodaySummary,
  LiveSummaryReport,
} from './LiveSummary.js'

/**
 * 获取运行中的任务
 */
export function getRunningTasks(): RunningTaskInfo[] {
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
          status:
            state.status === 'done'
              ? 'completed'
              : (state.status as 'pending' | 'running' | 'failed' | 'skipped'),
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
export function getQueuedTasks(): QueuedTaskInfo[] {
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
export function getTodaySummary(): TodaySummary {
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

  summary.avgSuccessRate =
    summary.tasksCreated > 0
      ? Math.round(
          (summary.tasksCompleted / (summary.tasksCompleted + summary.tasksFailed || 1)) * 100
        )
      : 0

  return summary
}

/**
 * 获取最近完成的任务
 */
export function getRecentCompleted(limit: number = 5): LiveSummaryReport['recentCompleted'] {
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

    const startedAt = instance?.startedAt ? new Date(instance.startedAt) : new Date(task.createdAt)

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
