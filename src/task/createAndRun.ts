/**
 * 创建任务并自动执行
 * 如果没有正在运行的任务，立即捡起执行
 */

import { getStore } from '../store/index.js'
import { createLogger } from '../shared/logger.js'
import { getOrCreateDefaultAgent } from '../agent/getDefaultAgent.js'
import { runAgent } from '../agent/runAgent.js'
import type { Task, TaskPriority } from '../types/task.js'

const logger = createLogger('task')

interface CreateAndRunOptions {
  description: string
  priority?: TaskPriority | string
  assignee?: string
  autoRun?: boolean
}

/**
 * 检查是否有正在运行的任务
 */
function hasRunningTask(): boolean {
  const store = getStore()
  const runningTasks = store.getTasksByStatus('planning')
    .concat(store.getTasksByStatus('developing'))
  return runningTasks.length > 0
}

/**
 * 创建任务并自动执行
 */
export async function createAndRunTask(options: CreateAndRunOptions): Promise<Task> {
  const store = getStore()

  // 创建任务
  const priority = (['low', 'medium', 'high'].includes(options.priority || '')
    ? options.priority
    : 'medium') as TaskPriority

  // 标题：如果描述超过47字，截断并加...
  const title = options.description.length > 47
    ? options.description.slice(0, 47) + '...'
    : options.description

  const task: Task = {
    id: crypto.randomUUID(),
    title,
    description: options.description,
    priority,
    status: 'pending',
    assignee: options.assignee,
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

  // 检查是否有正在运行的任务
  if (hasRunningTask()) {
    logger.info('Other tasks are running, queued for later')
    return task
  }

  // 没有运行中的任务，立即执行
  logger.info('No running tasks, starting immediately')

  // 确保默认 Agent 存在
  const agent = await getOrCreateDefaultAgent()

  // 执行任务
  await runAgent(agent.name)

  // 返回更新后的任务
  return store.getTask(task.id) || task
}
