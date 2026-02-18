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
import { registerTaskEventListeners } from '../messaging/registerTaskEventListeners.js'
import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'
import { releaseRunnerLock } from './spawnTask.js'
import { isRunningStatus } from '../types/taskStatus.js'

const logger = createLogger('queue-runner')

// Graceful shutdown state
let shuttingDown = false
let currentTaskId: string | null = null
let currentTaskPromise: Promise<void> | null = null

// Graceful shutdown timeout (wait up to 60s for current task node to finish)
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 60 * 1000

function setupSignalHandlers(): void {
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) {
      logger.info(`Received ${signal} again during shutdown, force exiting`)
      releaseRunnerLock()
      process.exit(1)
    }

    shuttingDown = true
    logger.info(`Received ${signal}, graceful shutdown initiated`)

    if (!currentTaskPromise) {
      // No task running, exit immediately
      logger.info('No task running, exiting immediately')
      releaseRunnerLock()
      process.exit(0)
    }

    logger.info(`Waiting for current task ${currentTaskId} to finish (timeout: ${GRACEFUL_SHUTDOWN_TIMEOUT_MS / 1000}s)...`)

    // Wait for current task or timeout
    const timeout = new Promise<void>(resolve =>
      setTimeout(() => {
        logger.warn(`Graceful shutdown timeout reached, force exiting`)
        resolve()
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS)
    )

    await Promise.race([currentTaskPromise, timeout])

    releaseRunnerLock()
    logger.info('Graceful shutdown complete')
    process.exit(0)
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
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

  // Register task event → notification bridge (so completion notifications are sent)
  registerTaskEventListeners()

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

      // Track current task for graceful shutdown
      currentTaskId = task.id
      const taskPromise = runTask(task)
        .then(() => {
          updateProcessInfo(task.id, { status: 'stopped' })
          logger.info(`Task completed: ${task.id}`)
        })
        .catch(error => {
          updateProcessInfo(task.id, { status: 'stopped' })
          const errorMessage = formatErrorMessage(error)
          logger.error(`Task failed: ${errorMessage}`)
          updateTask(task.id, { status: 'failed' })
        })
        .finally(() => {
          currentTaskId = null
          currentTaskPromise = null
        })
      currentTaskPromise = taskPromise
      await taskPromise

      // After task completes, check if we should stop accepting new tasks
      if (shuttingDown) {
        logger.info('Shutdown requested, not picking up more tasks')
        break
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
