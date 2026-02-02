/**
 * Task Recovery - 检测和恢复孤立/失败任务
 *
 * 1. 孤立任务：电脑关机或进程被杀死后，任务处于 planning/developing 状态但进程不存在
 * 2. 失败任务：workflow 执行失败（节点超过最大重试次数等）
 *
 * 这个模块负责检测并恢复这些任务。
 */

import { createLogger } from '../shared/logger.js'
import {
  getTask,
  getTasksByStatus,
  getProcessInfo,
  isProcessRunning,
  updateProcessInfo,
} from '../store/TaskStore.js'
import { getTaskInstance, getTaskWorkflow } from '../store/TaskWorkflowStore.js'
import { appendExecutionLog, appendJsonlLog } from '../store/TaskLogStore.js'
import { recoverWorkflowInstance } from '../workflow/index.js'
import { spawnTaskProcess } from './spawnTask.js'
import type { Task, TaskStatus } from '../types/task.js'

const logger = createLogger('resume-task')

// 需要检测的"正在运行"状态
const RUNNING_STATUSES: TaskStatus[] = ['planning', 'developing']

export interface OrphanedTask {
  task: Task
  pid: number
  lastHeartbeat?: string
  reason: 'process_not_found' | 'heartbeat_timeout'
}

/**
 * 检测孤立任务
 *
 * 孤立任务定义：
 * 1. 状态为 planning 或 developing
 * 2. 有 process.json 记录
 * 3. 但进程实际上已不存在
 */
export function detectOrphanedTasks(): OrphanedTask[] {
  const orphaned: OrphanedTask[] = []

  for (const status of RUNNING_STATUSES) {
    const tasks = getTasksByStatus(status)

    for (const task of tasks) {
      const processInfo = getProcessInfo(task.id)

      // 没有进程信息，可能是旧任务或异常创建的
      if (!processInfo) {
        logger.debug(`Task ${task.id} has no process info, treating as orphaned`)
        orphaned.push({
          task,
          pid: 0,
          reason: 'process_not_found',
        })
        continue
      }

      // 进程状态已经是 stopped 或 crashed，跳过
      if (processInfo.status !== 'running') {
        continue
      }

      // 检查进程是否存活
      if (!isProcessRunning(processInfo.pid)) {
        logger.info(`Task ${task.id} process ${processInfo.pid} not found`)
        orphaned.push({
          task,
          pid: processInfo.pid,
          lastHeartbeat: processInfo.lastHeartbeat,
          reason: 'process_not_found',
        })

        // 更新进程状态为 crashed
        updateProcessInfo(task.id, { status: 'crashed' })
      }
    }
  }

  return orphaned
}

/**
 * 恢复单个任务
 * 重新启动后台进程继续执行
 *
 * 关键逻辑：
 * 1. 检查是否已有 workflow - 如果有，使用 resume 模式继续执行
 * 2. 检查 workflow instance 状态 - 决定从哪个节点继续
 */
export function resumeTask(taskId: string): number | null {
  const processInfo = getProcessInfo(taskId)

  // 如果进程仍在运行，不需要恢复
  if (processInfo && processInfo.status === 'running' && isProcessRunning(processInfo.pid)) {
    logger.warn(`Task ${taskId} is still running (PID: ${processInfo.pid})`)
    return null
  }

  // 获取任务信息
  const task = getTask(taskId)
  if (!task) {
    logger.error(`Task not found: ${taskId}`)
    return null
  }

  // 检查是否已有 workflow - 决定是否使用 resume 模式
  const existingWorkflow = getTaskWorkflow(taskId)
  const existingInstance = getTaskInstance(taskId)
  const shouldResume = !!(existingWorkflow && existingInstance)

  logger.info(`Resuming task: ${taskId}`)
  if (shouldResume) {
    logger.info(`Found existing workflow: ${existingWorkflow!.id}, instance: ${existingInstance!.id}`)
    logger.info(`Instance status: ${existingInstance!.status}`)
  }

  // 记录 resume 到执行日志
  appendExecutionLog(taskId, `Task resumed, mode: ${shouldResume ? 'continue' : 'restart'}`, { scope: 'lifecycle' })

  // 写入结构化事件日志
  appendJsonlLog(taskId, {
    event: 'task_resumed',
    message: `Task resumed: ${task.title}`,
    data: {
      mode: shouldResume ? 'continue' : 'restart',
      workflowId: existingWorkflow?.id,
      instanceId: existingInstance?.id,
      instanceStatus: existingInstance?.status,
    },
  })

  // 重新启动后台进程
  const pid = spawnTaskProcess({
    taskId,
    resume: shouldResume,
  })

  logger.info(`Task ${taskId} resumed with PID: ${pid}`)
  return pid
}

/**
 * 恢复失败的任务
 * - 如果有 workflow instance：从失败点继续执行
 * - 如果没有 instance（workflow 生成阶段失败）：重新执行
 * 会自动启动后台进程
 */
export async function resumeFailedTask(taskId: string): Promise<{
  success: boolean
  failedNodeId?: string
  pid?: number
  error?: string
  mode?: 'continue' | 'restart'
}> {
  const task = getTask(taskId)
  if (!task) {
    return { success: false, error: `Task not found: ${taskId}` }
  }

  if (task.status !== 'failed') {
    return { success: false, error: `Task is not in failed status: ${task.status}` }
  }

  // 获取 workflow instance
  const instance = getTaskInstance(taskId)

  // 没有 instance 说明 workflow 生成阶段就失败了，需要重新执行
  if (!instance) {
    logger.info(`No workflow instance found, restarting task: ${taskId}`)

    // 记录到日志
    appendExecutionLog(taskId, 'Task restarted (no previous instance)', { scope: 'lifecycle' })
    appendJsonlLog(taskId, {
      event: 'task_restarted',
      message: `Task restarted: ${task.title}`,
      data: { reason: 'no_instance' },
    })

    // 启动后台进程（非 resume 模式，从头开始）
    const pid = spawnTaskProcess({
      taskId,
      resume: false,
    })

    logger.info(`Task process started (restart mode): PID ${pid}`)
    return { success: true, pid, mode: 'restart' }
  }

  // 有 instance，恢复 workflow instance（重置失败节点状态）
  const result = await recoverWorkflowInstance(instance.id)
  if (!result.success) {
    return result
  }

  logger.info(`Failed task recovered: ${taskId}, node: ${result.failedNodeId}`)

  // 启动后台进程（使用 resume 模式）
  const pid = spawnTaskProcess({
    taskId,
    resume: true,
  })

  logger.info(`Task process started: PID ${pid}`)

  return { ...result, pid, mode: 'continue' }
}

/**
 * 恢复所有孤立任务
 */
export function resumeAllOrphanedTasks(): Array<{ taskId: string; pid: number }> {
  const orphaned = detectOrphanedTasks()
  const resumed: Array<{ taskId: string; pid: number }> = []

  for (const { task } of orphaned) {
    const pid = resumeTask(task.id)
    if (pid) {
      resumed.push({ taskId: task.id, pid })
    }
  }

  return resumed
}

/**
 * 获取孤立任务摘要信息（用于 CLI 显示）
 */
export function getOrphanedTasksSummary(): string[] {
  const orphaned = detectOrphanedTasks()

  return orphaned.map(({ task, pid, reason }) => {
    const title = task.title.length > 40 ? task.title.slice(0, 37) + '...' : task.title
    const status = task.status
    const reasonText = reason === 'process_not_found' ? 'process dead' : 'heartbeat timeout'
    return `[${status}] ${title} (PID: ${pid}, ${reasonText})`
  })
}

/**
 * 获取失败任务列表
 */
export function getFailedTasks(): Task[] {
  return getTasksByStatus('failed')
}
