/**
 * Task query operations: list, get detail, poll
 *
 * Display/formatting logic split to formatTask.ts
 */

import chalk from 'chalk'
import {
  getAllTasks,
  getTasksByStatus,
} from '../store/TaskStore.js'
import { getStore } from '../store/index.js'
import type { Task } from '../types/task.js'
import { parseTaskStatus } from '../types/task.js'
import { renderTaskList } from './formatTask.js'

// Re-export display functions for backward compatibility
export { getTaskDetail, type GetTaskDetailOptions } from './formatTask.js'

// ============ List Tasks ============

export interface ListOptions {
  status?: string
  agent?: string
  source?: string
  cwd?: string
  progress?: boolean
  watch?: boolean
  interval?: number
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

  if (options.source) {
    tasks = tasks.filter(t => t.source === options.source)
  }

  if (options.cwd) {
    const filterCwd = options.cwd
    tasks = tasks.filter(t => t.cwd === filterCwd)
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
