/**
 * Worker 抽象
 * 可复用的后台任务执行器
 */

import { type Result, ok, err, fromPromise } from '../shared/result.js'
import { createLogger, type Logger } from '../shared/logger.js'
import { emitEvent } from './eventBus.js'

export type WorkerStatus = 'idle' | 'running' | 'paused' | 'stopped'

export interface WorkerConfig {
  name: string
  // 最大并发数
  concurrency?: number
  // 任务超时（毫秒）
  timeout?: number
  // 失败后重试次数
  maxRetries?: number
  // 重试延迟（毫秒）
  retryDelay?: number
}

export interface Worker<T, R> {
  // 启动 worker
  start(): void
  // 停止 worker
  stop(): Promise<void>
  // 暂停
  pause(): void
  // 恢复
  resume(): void
  // 执行单个任务
  execute(task: T): Promise<Result<R, Error>>
  // 获取状态
  status(): WorkerStatus
  // 当前运行任务数
  runningCount(): number
}

export interface WorkerContext<T> {
  task: T
  attempt: number
  logger: Logger
  signal: AbortSignal
}

export type TaskHandler<T, R> = (ctx: WorkerContext<T>) => Promise<R>

export function createWorker<T, R>(
  config: WorkerConfig,
  handler: TaskHandler<T, R>
): Worker<T, R> {
  const logger = createLogger(config.name)
  let currentStatus: WorkerStatus = 'idle'
  let runningTasks = 0
  const abortControllers = new Set<AbortController>()

  const isStopped = () => currentStatus === 'stopped'

  const {
    concurrency = 1,
    timeout = 30000,
    maxRetries = 0,
    retryDelay = 1000,
  } = config

  async function executeWithRetry(task: T, attempt: number = 1): Promise<Result<R, Error>> {
    if (isStopped()) {
      return err(new Error('Worker stopped'))
    }

    // 等待恢复（如果暂停）
    while (currentStatus === 'paused') {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    const controller = new AbortController()
    abortControllers.add(controller)

    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const ctx: WorkerContext<T> = {
      task,
      attempt,
      logger,
      signal: controller.signal,
    }

    try {
      runningTasks++
      const result = await fromPromise(handler(ctx))
      clearTimeout(timeoutId)
      abortControllers.delete(controller)
      runningTasks--

      if (result.ok) {
        return result
      }

      // 失败后重试
      if (attempt < maxRetries + 1) {
        logger.warn(`Task failed, retrying (${attempt}/${maxRetries})...`)
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt))
        return executeWithRetry(task, attempt + 1)
      }

      return result
    } catch (e) {
      clearTimeout(timeoutId)
      abortControllers.delete(controller)
      runningTasks--

      const error = e instanceof Error ? e : new Error(String(e))

      // 失败后重试
      if (attempt < maxRetries + 1) {
        logger.warn(`Task failed, retrying (${attempt}/${maxRetries})...`)
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt))
        return executeWithRetry(task, attempt + 1)
      }

      return err(error)
    }
  }

  return {
    start(): void {
      if (currentStatus === 'running') return
      currentStatus = 'running'
      logger.info('Worker started')
    },

    async stop(): Promise<void> {
      currentStatus = 'stopped'

      // 取消所有进行中的任务
      for (const controller of abortControllers) {
        controller.abort()
      }
      abortControllers.clear()

      // 等待所有任务完成
      while (runningTasks > 0) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      logger.info('Worker stopped')
    },

    pause(): void {
      if (currentStatus === 'running') {
        currentStatus = 'paused'
        logger.info('Worker paused')
      }
    },

    resume(): void {
      if (currentStatus === 'paused') {
        currentStatus = 'running'
        logger.info('Worker resumed')
      }
    },

    async execute(task: T): Promise<Result<R, Error>> {
      if (isStopped()) {
        return err(new Error('Worker is stopped'))
      }

      // 等待有空闲槽位
      while (runningTasks >= concurrency && !isStopped()) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }

      return executeWithRetry(task)
    },

    status(): WorkerStatus {
      return currentStatus
    },

    runningCount(): number {
      return runningTasks
    },
  }
}

// Agent Worker 类型定义
export interface AgentTask {
  agentName: string
  taskId: string
}

export interface AgentTaskResult {
  taskId: string
  success: boolean
  commitHash?: string
  error?: string
}

// 创建 Agent 专用 Worker
export function createAgentWorker(
  agentName: string,
  handler: TaskHandler<AgentTask, AgentTaskResult>
): Worker<AgentTask, AgentTaskResult> {
  const worker = createWorker<AgentTask, AgentTaskResult>(
    {
      name: `agent:${agentName}`,
      concurrency: 1, // Agent 一次只处理一个任务
      timeout: 30 * 60 * 1000, // 30 分钟超时
      maxRetries: 2,
      retryDelay: 5000,
    },
    handler
  )

  // 包装以添加事件发射
  const originalExecute = worker.execute.bind(worker)
  worker.execute = async (task: AgentTask) => {
    await emitEvent('task:started', { taskId: task.taskId, agentName: task.agentName })

    const result = await originalExecute(task)

    if (result.ok && result.value.success) {
      await emitEvent('task:completed', { taskId: task.taskId, agentName: task.agentName })
    } else {
      const errorMsg = result.ok ? result.value.error : result.error.message
      await emitEvent('task:failed', {
        taskId: task.taskId,
        agentName: task.agentName,
        error: errorMsg ?? 'Unknown error',
      })
    }

    return result
  }

  return worker
}
