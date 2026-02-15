/**
 * 创建任务并自动执行
 * 如果没有正在运行的任务，启动后台 runner（不阻塞）
 */

import { getStore } from '../store/index.js'
import { createLogger } from '../shared/logger.js'
import { parseTaskPriority } from '../types/task.js'
import { truncateText } from '../shared/truncateText.js'
import type { Task, TaskPriority } from '../types/task.js'

const logger = createLogger('task')

interface CreateAndRunOptions {
  description: string
  priority?: TaskPriority | string
  assignee?: string
  backend?: string
  model?: string
  autoRun?: boolean
}

/**
 * 检查是否有正在运行的任务
 */
function hasRunningTask(): boolean {
  const store = getStore()
  const runningTasks = store
    .getTasksByStatus('planning')
    .concat(store.getTasksByStatus('developing'))
  return runningTasks.length > 0
}

/**
 * 创建任务并自动执行
 */
export async function createAndRunTask(options: CreateAndRunOptions): Promise<Task> {
  const store = getStore()

  // 创建任务
  const priority = parseTaskPriority(options.priority)

  const title = truncateText(options.description, 50)

  const task: Task = {
    id: crypto.randomUUID(),
    title,
    description: options.description,
    priority,
    status: 'pending',
    assignee: options.assignee,
    backend: options.backend,
    model: options.model,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  }

  store.saveTask(task)
  logger.info(`Task created: ${task.id.slice(0, 8)} - ${task.title}`)

  // 如果 autoRun 为 false，只创建任务不执行
  if (options.autoRun === false) {
    logger.info('Auto-run disabled, task queued')
    return task
  }

  // 启动后台 runner（不阻塞，立即返回）
  // Runner 会自动检测 pending 任务并串行执行
  const { spawnTaskRunner } = await import('./spawnTask.js')
  spawnTaskRunner()

  if (hasRunningTask()) {
    logger.info('Task queued (other tasks running)')
  } else {
    logger.info('Task queued, runner started')
  }

  return task
}
