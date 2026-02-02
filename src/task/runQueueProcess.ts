#!/usr/bin/env node
/**
 * Background queue runner process
 *
 * 串行执行队列中所有 pending 任务
 * 执行完毕后自动退出
 */

import { runTask } from './runTask.js'
import { getAllTasks, getTask, updateTask } from '../store/TaskStore.js'
import { createLogger } from '../shared/logger.js'
import { releaseRunnerLock } from './spawnTask.js'

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
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`)
    releaseRunnerLock()
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
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
      // 获取所有任务，找到 pending 状态的
      const allTasks = getAllTasks()
      const pendingTask = allTasks.find(t => t.status === 'pending')

      if (!pendingTask) {
        logger.info('No pending tasks, exiting')
        break
      }

      const task = getTask(pendingTask.id)
      if (!task) {
        logger.warn(`Task ${pendingTask.id} not found`)
        continue
      }

      logger.info(`Executing task: ${task.title}`)

      try {
        await runTask(task)
        logger.info(`Task completed: ${task.id}`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
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
  console.error('Fatal error:', err)
  process.exit(1)
})
