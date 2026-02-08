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
  type ProcessInfo,
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

// 孤立任务检测宽限期（秒）- 新任务在此时间内不算孤立
const ORPHAN_GRACE_PERIOD_MS = 30 * 1000

// 进程活跃心跳阈值（毫秒）- 如果心跳在此时间内，认为进程仍在运行
const HEARTBEAT_ALIVE_THRESHOLD_MS = 30 * 1000

// 进程启动宽限期（毫秒）- 进程刚启动时可能还没写心跳
const PROCESS_START_GRACE_MS = 10 * 1000

/**
 * 检查进程是否活跃（基于心跳和启动时间）
 *
 * 比单纯的 PID 检查更可靠：
 * 1. 如果进程刚启动（在宽限期内），认为活跃
 * 2. 如果心跳在阈值内，认为活跃
 * 3. 否则才检查 PID 是否存在
 */
function isProcessActive(processInfo: ProcessInfo | null): boolean {
  if (!processInfo) return false

  // 进程状态已经是 stopped 或 crashed，明确不活跃
  if (processInfo.status !== 'running') return false

  const now = Date.now()

  // 检查进程启动时间 - 刚启动的进程可能还没写心跳
  if (processInfo.startedAt) {
    const startedAt = new Date(processInfo.startedAt).getTime()
    if (now - startedAt < PROCESS_START_GRACE_MS) {
      logger.debug(
        `Process started recently (${Math.round((now - startedAt) / 1000)}s ago), treating as active`
      )
      return true
    }
  }

  // 检查心跳 - 心跳新鲜说明进程活跃
  if (processInfo.lastHeartbeat) {
    const lastHeartbeat = new Date(processInfo.lastHeartbeat).getTime()
    if (now - lastHeartbeat < HEARTBEAT_ALIVE_THRESHOLD_MS) {
      logger.debug(
        `Process heartbeat recent (${Math.round((now - lastHeartbeat) / 1000)}s ago), treating as active`
      )
      return true
    }
  }

  // 最后检查 PID 是否存在
  return isProcessRunning(processInfo.pid)
}

/**
 * 检测孤立任务
 *
 * 孤立任务定义：
 * 1. 状态为 planning 或 developing
 * 2. 有 process.json 记录
 * 3. 但进程实际上已不存在
 * 4. 且任务创建时间超过宽限期
 */
export function detectOrphanedTasks(): OrphanedTask[] {
  const orphaned: OrphanedTask[] = []
  const now = Date.now()

  for (const status of RUNNING_STATUSES) {
    const tasks = getTasksByStatus(status)

    for (const task of tasks) {
      // 检查任务是否在宽限期内（刚创建的任务可能还没写入 process.json）
      const taskAge = now - new Date(task.updatedAt || task.createdAt).getTime()
      if (taskAge < ORPHAN_GRACE_PERIOD_MS) {
        logger.debug(
          `Task ${task.id} is within grace period (${Math.round(taskAge / 1000)}s old), skipping`
        )
        continue
      }

      const processInfo = getProcessInfo(task.id)

      // 没有进程信息 — 区分"从未执行"和"执行中断"
      if (!processInfo) {
        const hasWorkflow = !!getTaskWorkflow(task.id)
        if (!hasWorkflow) {
          // 无 workflow 说明任务从未真正开始执行，不是 orphan
          logger.debug(
            `Task ${task.id} has no process info and no workflow, skipping (never executed)`
          )
          continue
        }
        // 有 workflow 但没有 process.json，说明执行中断且进程信息丢失
        logger.info(`Task ${task.id} has workflow but no process info, treating as orphaned`)
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

      // 检查进程是否存活（使用 isProcessActive 综合判断：心跳、启动时间、PID）
      if (!isProcessActive(processInfo)) {
        logger.info(
          `Task ${task.id} process ${processInfo.pid} not active (heartbeat: ${processInfo.lastHeartbeat})`
        )
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
 * 1. 检查进程是否活跃（基于心跳、启动时间、PID）
 * 2. 检查是否已有 workflow - 如果有，使用 resume 模式继续执行
 * 3. 检查 workflow instance 状态 - 决定从哪个节点继续
 */
export function resumeTask(taskId: string): number | null {
  const processInfo = getProcessInfo(taskId)

  // 如果进程仍然活跃，不需要恢复
  if (isProcessActive(processInfo)) {
    logger.warn(`Task ${taskId} is still actively running (PID: ${processInfo?.pid})`)
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

  // 如果 instance 已完成，不需要恢复
  if (existingInstance && existingInstance.status === 'completed') {
    logger.info(`Task ${taskId} instance already completed, skipping resume`)
    return null
  }

  const shouldResume = !!(existingWorkflow && existingInstance)

  logger.info(`Resuming task: ${taskId}`)
  if (shouldResume && existingWorkflow && existingInstance) {
    logger.info(`Found existing workflow: ${existingWorkflow.id}, instance: ${existingInstance.id}`)
    logger.info(`Instance status: ${existingInstance.status}`)
  }

  // 记录 resume 到执行日志
  appendExecutionLog(taskId, `Task resumed, mode: ${shouldResume ? 'continue' : 'restart'}`, {
    scope: 'lifecycle',
  })

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

  // 检查是否有进程仍在活跃（防止竞态条件）
  const processInfo = getProcessInfo(taskId)
  if (isProcessActive(processInfo)) {
    return {
      success: false,
      error: `Task ${taskId} has an active process (PID: ${processInfo?.pid}). Wait for it to complete or kill it first.`,
    }
  }

  // 获取 workflow instance
  const instance = getTaskInstance(taskId)

  // 没有 instance 说明 workflow 生成阶段就失败了，需要重新执行
  if (!instance) {
    logger.info(`No workflow instance found, restarting task: ${taskId}`)

    // 记录到日志
    appendExecutionLog(taskId, 'Task restarted (no previous instance)', { scope: 'lifecycle' })
    appendJsonlLog(taskId, {
      event: 'task_started',
      message: `Task restarted: ${task.title}`,
      data: { reason: 'no_instance', mode: 'restart' },
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
