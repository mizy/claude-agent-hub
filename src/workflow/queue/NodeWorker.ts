/**
 * 节点 Worker
 * 基于 SQLite 队列处理节点任务
 */

import { getNextJob, completeJob, failJob, markJobFailed, markJobWaiting, enqueueNode } from './WorkflowQueue.js'
import { getInstance } from '../../store/WorkflowStore.js'
import { failWorkflowInstance, markNodeWaiting } from '../engine/StateManager.js'
import { createLogger } from '../../shared/logger.js'
import type { NodeJobData, NodeJobResult } from '../types.js'

const logger = createLogger('node-worker')

// Maximum attempts per node (prevents infinite retry loops)
const MAX_NODE_ATTEMPTS = 3

export type NodeProcessor = (data: NodeJobData) => Promise<NodeJobResult>

export interface WorkerOptions {
  concurrency?: number
  pollInterval?: number  // 轮询间隔，毫秒
  processor: NodeProcessor
  instanceId?: string    // 绑定到特定 instance，实现队列隔离
}

interface WorkerState {
  running: boolean
  paused: boolean
  activeJobs: number
  pollTimer: NodeJS.Timeout | null
}

const state: WorkerState = {
  running: false,
  paused: false,
  activeJobs: 0,
  pollTimer: null,
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
    concurrency: options.concurrency ?? 5,
    pollInterval: options.pollInterval ?? 1000,
    processor: options.processor,
    instanceId: options.instanceId,
  }

  if (workerOptions.instanceId) {
    logger.info(`Worker created with concurrency: ${workerOptions.concurrency}, bound to instance: ${workerOptions.instanceId}`)
  } else {
    logger.info(`Worker created with concurrency: ${workerOptions.concurrency} (global, no instance filter)`)
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

  logger.info(`Processing node: ${nodeId} (instance: ${instanceId}, attempt: ${currentAttempts + 1})`)

  // Check if max attempts exceeded
  if (currentAttempts >= MAX_NODE_ATTEMPTS) {
    const errorMsg = `Node ${nodeId} exceeded max attempts (${MAX_NODE_ATTEMPTS})`
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

      logger.warn(`Node failed: ${nodeId} - ${result.error}`)

      // Check if we should retry or give up
      if (currentAttempts + 1 >= MAX_NODE_ATTEMPTS) {
        logger.error(`Node ${nodeId} failed after ${currentAttempts + 1} attempts, giving up`)
        markJobFailed(jobId, result.error || 'Unknown error')
        await failWorkflowInstance(instanceId, `Node ${nodeId} failed: ${result.error}`)
      } else {
        // Still have retries left
        failJob(jobId, result.error || 'Unknown error')
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Node error: ${nodeId} - ${errorMessage}`)

    if (currentAttempts + 1 >= MAX_NODE_ATTEMPTS) {
      logger.error(`Node ${nodeId} errored after ${currentAttempts + 1} attempts, giving up`)
      markJobFailed(jobId, errorMessage)
      await failWorkflowInstance(instanceId, `Node ${nodeId} error: ${errorMessage}`)
    } else {
      failJob(jobId, errorMessage)
    }
  } finally {
    state.activeJobs--
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
