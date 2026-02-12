#!/usr/bin/env node
/**
 * Background queue runner process
 *
 * 串行执行队列中所有 pending 任务
 * 执行完毕后自动退出
 */

import { runTask } from './runTask.js'
import {
  getAllTasks,
  getTask,
  updateTask,
  saveProcessInfo,
  updateProcessInfo,
} from '../store/TaskStore.js'
import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'
import { releaseRunnerLock } from './spawnTask.js'
import { isRunningStatus } from '../types/taskStatus.js'

const logger = createLogger('queue-runner')

// 确保异常退出时也能清理锁文件
function setupSignalHandlers(): void {
  const cleanup = (signal: string) => {
    logger.info(`Received ${signal}, cleaning up...`)
    releaseRunnerLock()
    process.exit(0)
  }

  process.on('SIGINT', () => cleanup('SIGINT'))
  process.on('SIGTERM', () => cleanup('SIGTERM'))
  process.on('uncaughtException', err => {
    logger.error(`Uncaught exception: ${err.message}`)
    releaseRunnerLock()
    process.exit(1)
  })
  process.on('unhandledRejection', reason => {
    logger.error(`Unhandled rejection: ${reason}`)
    releaseRunnerLock()
    process.exit(1)
  })
}

setupSignalHandlers()

async function main(): Promise<void> {
  logger.info('Queue runner started')

  try {
    // 循环执行所有 pending 任务
    while (true) {
      // 获取所有任务
      const allTasks = getAllTasks()

      // 收集正在运行的任务的 cwd 集合（用于冲突检测）
      const runningCwds = new Set(
        allTasks
          .filter(t => isRunningStatus(t.status) && t.cwd)
          .map(t => t.cwd!)
      )

      // 找第一个不与运行中任务冲突的 pending 任务
      const pendingTask = allTasks.find(
        t => t.status === 'pending' && (!t.cwd || !runningCwds.has(t.cwd))
      )

      if (!pendingTask) {
        // 可能还有 pending 但全部与运行中任务冲突
        const blockedCount = allTasks.filter(t => t.status === 'pending').length
        if (blockedCount > 0) {
          logger.info(`${blockedCount} pending task(s) blocked by same-project running tasks, exiting`)
        } else {
          logger.info('No pending tasks, exiting')
        }
        break
      }

      const task = getTask(pendingTask.id)
      if (!task) {
        logger.warn(`Task ${pendingTask.id} not found`)
        continue
      }

      logger.info(`Executing task: ${task.title}`)

      // 写入 process.json，防止 orphan detection 误判
      saveProcessInfo(task.id, {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        status: 'running',
      })

      try {
        await runTask(task)
        updateProcessInfo(task.id, { status: 'stopped' })
        logger.info(`Task completed: ${task.id}`)
      } catch (error) {
        updateProcessInfo(task.id, { status: 'stopped' })
        const errorMessage = formatErrorMessage(error)
        logger.error(`Task failed: ${errorMessage}`)
        updateTask(task.id, { status: 'failed' })
      }
    }
  } finally {
    // 退出前释放锁
    releaseRunnerLock()
    logger.info('Queue runner finished')
  }
}

main().catch(err => {
  releaseRunnerLock()
  logger.error(`Fatal error: ${formatErrorMessage(err)}`)
  process.exit(1)
})
