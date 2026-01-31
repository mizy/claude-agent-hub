/**
 * Task Recovery - 检测和恢复孤立任务
 *
 * 当电脑关机或进程被杀死后，任务可能处于 planning/developing 状态
 * 但实际进程已不存在。这个模块负责检测这些孤立任务并恢复执行。
 */

import { createLogger } from '../shared/logger.js'
import {
  getTasksByStatus,
  getProcessInfo,
  isProcessRunning,
  updateProcessInfo,
} from '../store/TaskStore.js'
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
 */
export function resumeTask(taskId: string, agentName?: string): number | null {
  const processInfo = getProcessInfo(taskId)

  // 如果进程仍在运行，不需要恢复
  if (processInfo && processInfo.status === 'running' && isProcessRunning(processInfo.pid)) {
    logger.warn(`Task ${taskId} is still running (PID: ${processInfo.pid})`)
    return null
  }

  // 获取之前的 agent name
  const agent = agentName || processInfo?.pid ? 'default' : 'default'

  logger.info(`Resuming task: ${taskId}`)

  // 重新启动后台进程
  const pid = spawnTaskProcess({
    taskId,
    agentName: agent,
  })

  logger.info(`Task ${taskId} resumed with PID: ${pid}`)
  return pid
}

/**
 * 恢复所有孤立任务
 */
export function resumeAllOrphanedTasks(): Array<{ taskId: string; pid: number }> {
  const orphaned = detectOrphanedTasks()
  const resumed: Array<{ taskId: string; pid: number }> = []

  for (const { task } of orphaned) {
    const pid = resumeTask(task.id, task.assignee)
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
