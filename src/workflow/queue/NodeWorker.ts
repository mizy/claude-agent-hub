/**
 * 节点 Worker
 * 基于 SQLite 队列处理节点任务
 */

import {
  getNextJob,
  completeJob,
  markJobFailed,
  markJobWaiting,
  enqueueNode,
} from './WorkflowQueue.js'
import { getInstance, getWorkflow } from '../../store/WorkflowStore.js'
import { failWorkflowInstance, markNodeWaiting } from '../engine/StateManager.js'
import { createLogger } from '../../shared/logger.js'
import { isError, getErrorStack, getErrorMessage } from '../../shared/assertError.js'
import {
  shouldRetry,
  classifyError,
  formatRetryInfo,
  DEFAULT_RETRY_CONFIG,
} from '../engine/RetryStrategy.js'
import type { NodeJobData, NodeJobResult, WorkflowNode } from '../types.js'

const logger = createLogger('node-worker')

export type NodeProcessor = (data: NodeJobData) => Promise<NodeJobResult>

export interface WorkerOptions {
  concurrency?: number
  pollInterval?: number // 轮询间隔，毫秒
  processor: NodeProcessor
  instanceId?: string // 绑定到特定 instance，实现队列隔离
}

interface WorkerState {
  running: boolean
  paused: boolean
  activeJobs: number
  pollTimer: NodeJS.Timeout | null
  retryTimers: Set<NodeJS.Timeout> // 跟踪所有重试定时器
}

const state: WorkerState = {
  running: false,
  paused: false,
  activeJobs: 0,
  pollTimer: null,
  retryTimers: new Set(),
}

let workerOptions: WorkerOptions | null = null

/**
 * 创建 Worker
 */
export function createNodeWorker(options: WorkerOptions): void {
  if (workerOptions) {
    logger.warn('Worker already exists')
    return
  }

  workerOptions = {
    concurrency: options.concurrency ?? 3,
    pollInterval: options.pollInterval ?? 1000,
    processor: options.processor,
    instanceId: options.instanceId,
  }

  if (workerOptions.instanceId) {
    logger.info(
      `Worker created with concurrency: ${workerOptions.concurrency}, bound to instance: ${workerOptions.instanceId}`
    )
  } else {
    logger.info(
      `Worker created with concurrency: ${workerOptions.concurrency} (global, no instance filter)`
    )
  }
}

/**
 * 获取 Worker（兼容旧接口）
 */
export function getNodeWorker(): WorkerOptions | null {
  return workerOptions
}

/**
 * 启动 Worker
 */
export async function startWorker(): Promise<void> {
  if (!workerOptions) {
    throw new Error('Worker not created. Call createNodeWorker first.')
  }

  if (state.running) {
    logger.warn('Worker already running')
    return
  }

  state.running = true
  state.paused = false

  logger.info('Worker started')

  // 开始轮询
  pollForJobs()
}

/**
 * 轮询处理任务
 */
async function pollForJobs(): Promise<void> {
  if (!state.running || state.paused || !workerOptions) {
    return
  }

  // 检查是否达到并发上限
  if (state.activeJobs >= (workerOptions.concurrency ?? 5)) {
    scheduleNextPoll()
    return
  }

  // 获取下一个任务（只获取绑定 instance 的任务）
  const job = getNextJob(workerOptions.instanceId)

  if (job) {
    // 异步处理任务，不阻塞轮询
    processJob(job.id, job.data).catch(err => {
      logger.error(`Error processing job ${job.id}:`, err)
    })
  }

  scheduleNextPoll()
}

/**
 * 调度下一次轮询
 */
function scheduleNextPoll(): void {
  if (!state.running || state.paused || !workerOptions) {
    return
  }

  state.pollTimer = setTimeout(() => {
    pollForJobs()
  }, workerOptions.pollInterval ?? 1000)
}

/**
 * 获取节点的重试配置
 */
function getNodeRetryConfig(workflowId: string, nodeId: string): WorkflowNode['retry'] | undefined {
  const workflow = getWorkflow(workflowId)
  if (!workflow) return undefined

  const node = workflow.nodes.find(n => n.id === nodeId)
  return node?.retry
}

/**
 * 处理单个任务
 */
async function processJob(jobId: string, data: NodeJobData): Promise<void> {
  if (!workerOptions) return

  state.activeJobs++

  const { workflowId, instanceId, nodeId } = data

  // Check node attempts from instance state (source of truth)
  const instance = getInstance(instanceId)
  const nodeState = instance?.nodeStates[nodeId]
  const currentAttempts = nodeState?.attempts || 0

  // Get node-specific retry config
  const nodeRetryConfig = getNodeRetryConfig(workflowId, nodeId)
  const maxAttempts = nodeRetryConfig?.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts

  logger.info(
    `Processing node: ${nodeId} (instance: ${instanceId}, attempt: ${currentAttempts + 1}/${maxAttempts})`
  )

  // Check if max attempts exceeded
  if (currentAttempts >= maxAttempts) {
    // 包含最后一次失败的详细原因
    const lastError = nodeState?.error || 'Unknown error'
    const errorMsg = `Node ${nodeId} exceeded max attempts (${maxAttempts}). Last error: ${lastError}`
    logger.error(errorMsg)
    markJobFailed(jobId, errorMsg)

    // Fail the entire workflow
    await failWorkflowInstance(instanceId, errorMsg)

    state.activeJobs--
    return
  }

  try {
    const result = await workerOptions.processor(data)

    if (result.success) {
      logger.info(`Node completed: ${nodeId}`)
      completeJob(jobId)

      // 入队下游节点
      if (result.nextNodes && result.nextNodes.length > 0) {
        for (const nextNodeId of result.nextNodes) {
          await enqueueNode({
            workflowId,
            instanceId,
            nodeId: nextNodeId,
            attempt: 1,
          })
        }
        logger.debug(`Enqueued ${result.nextNodes.length} downstream nodes`)
      }
    } else {
      // Special handling for human approval nodes
      if (result.error === 'WAITING_FOR_APPROVAL') {
        logger.info(`Node ${nodeId} waiting for human approval`)
        markJobWaiting(jobId)
        await markNodeWaiting(instanceId, nodeId)
        // Don't retry, just wait for manual approval
        return
      }

      // Special handling for schedule-wait nodes
      if (result.error === 'WAITING_FOR_SCHEDULE') {
        logger.info(`Node ${nodeId} waiting for scheduled time`)
        markJobWaiting(jobId)
        await markNodeWaiting(instanceId, nodeId)
        // Don't retry — daemon's waitingRecoveryJob will resume when time arrives
        return
      }

      // Special handling for autoWait pause
      if (result.error === 'AUTO_WAIT_PAUSED') {
        logger.info(`Node ${nodeId} triggered autoWait pause, job stays waiting`)
        markJobWaiting(jobId)
        // Don't mark node as failed or retry — it will be re-queued on resume
        return
      }

      // Use smart retry strategy
      await handleNodeFailure(
        jobId,
        data,
        result.error || 'Node execution failed (no error message provided)',
        currentAttempts,
        nodeRetryConfig
      )
    }
  } catch (error) {
    // 捕获完整的错误信息，包括堆栈
    let errorMessage: string
    if (isError(error)) {
      errorMessage = getErrorStack(error) || error.message || 'Unknown error'
    } else if (error === undefined || error === null) {
      errorMessage = 'Unknown error (undefined/null error object)'
    } else {
      errorMessage = String(error)
    }

    // Use smart retry strategy
    await handleNodeFailure(jobId, data, errorMessage, currentAttempts, nodeRetryConfig)
  } finally {
    state.activeJobs--
  }
}

/**
 * 处理节点失败，使用智能重试策略
 */
async function handleNodeFailure(
  jobId: string,
  data: NodeJobData,
  errorMessage: string,
  currentAttempts: number,
  nodeRetryConfig?: WorkflowNode['retry']
): Promise<void> {
  const { workflowId, instanceId, nodeId } = data

  // 确保错误信息不为空
  const safeErrorMessage = errorMessage || 'Unknown error (no error message provided)'

  // 使用智能重试策略判断是否应该重试
  const retryDecision = shouldRetry(safeErrorMessage, currentAttempts + 1, nodeRetryConfig)

  logger.warn(`Node ${nodeId} failed: ${safeErrorMessage}`)
  logger.info(formatRetryInfo(retryDecision))

  // 分类错误用于日志和分析
  const classified = classifyError(errorMessage)
  logger.debug(`Error category: ${classified.category}, retryable: ${classified.retryable}`)

  // 保存错误上下文到节点状态（用于断点续跑诊断）
  const { updateNodeState } = await import('../../store/WorkflowStore.js')
  const instance = getInstance(instanceId)
  if (instance) {
    const currentState = instance.nodeStates[nodeId]
    updateNodeState(instanceId, nodeId, {
      ...currentState,
      error: safeErrorMessage,
      lastErrorCategory: classified.category,
      context: {
        ...currentState?.context,
        lastRetryDelayMs: retryDecision.delayMs,
        variables: instance.variables,
      },
    })
  }

  if (!retryDecision.shouldRetry) {
    // 不再重试，标记为永久失败
    logger.error(`Node ${nodeId} permanently failed: ${retryDecision.reason}`)
    markJobFailed(jobId, safeErrorMessage)
    await failWorkflowInstance(instanceId, `Node ${nodeId} failed: ${safeErrorMessage}`)
  } else {
    // 需要重试
    logger.info(`Scheduling retry for node ${nodeId} in ${retryDecision.delayMs}ms`)

    // Mark current job as permanently failed — retry is handled exclusively
    // via enqueueNode below, avoiding double retry (failJob would also re-queue)
    markJobFailed(jobId, safeErrorMessage)

    // 如果有延迟，使用 setTimeout 延迟入队
    if (retryDecision.delayMs > 0) {
      const timer = setTimeout(async () => {
        state.retryTimers.delete(timer)
        // Worker 已关闭则不再入队
        if (!state.running) {
          logger.debug(`Worker stopped, skipping retry for node ${nodeId}`)
          return
        }
        try {
          await enqueueNode({
            workflowId,
            instanceId,
            nodeId,
            attempt: retryDecision.nextAttempt,
          })
          logger.debug(`Retry job enqueued for node ${nodeId}`)
        } catch (retryError) {
          logger.error(
            `Failed to enqueue retry for node ${nodeId}: ${getErrorMessage(retryError)}`
          )
        }
      }, retryDecision.delayMs)
      state.retryTimers.add(timer)
    } else {
      // 立即重试
      await enqueueNode({
        workflowId,
        instanceId,
        nodeId,
        attempt: retryDecision.nextAttempt,
      })
    }
  }
}

/**
 * 暂停 Worker
 */
export async function pauseWorker(): Promise<void> {
  state.paused = true

  if (state.pollTimer) {
    clearTimeout(state.pollTimer)
    state.pollTimer = null
  }

  logger.info('Worker paused')
}

/**
 * 恢复 Worker
 */
export async function resumeWorker(): Promise<void> {
  if (!state.running) {
    logger.warn('Worker not running, use startWorker instead')
    return
  }

  state.paused = false
  pollForJobs()

  logger.info('Worker resumed')
}

/**
 * 关闭 Worker
 */
export async function closeWorker(): Promise<void> {
  state.running = false
  state.paused = false

  if (state.pollTimer) {
    clearTimeout(state.pollTimer)
    state.pollTimer = null
  }

  // 清除所有重试定时器
  const timerCount = state.retryTimers.size
  for (const timer of state.retryTimers) {
    clearTimeout(timer)
  }
  state.retryTimers.clear()
  if (timerCount > 0) {
    logger.debug(`Cleared ${timerCount} retry timers`)
  }

  // 等待活跃任务完成
  while (state.activeJobs > 0) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  workerOptions = null
  state.activeJobs = 0

  logger.info('Worker closed')
}

/**
 * 检查 Worker 是否运行中
 */
export function isWorkerRunning(): boolean {
  return state.running && !state.paused
}
