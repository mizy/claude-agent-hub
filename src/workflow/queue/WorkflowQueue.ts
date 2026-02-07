/**
 * Workflow 任务队列
 * 基于 JSON 文件实现
 */

import { existsSync, unlinkSync, writeFileSync, statSync } from 'fs'
import { createLogger } from '../../shared/logger.js'
import { readJson, writeJson, ensureDir } from '../../store/readWriteJson.js'
import { QUEUE_FILE, DATA_DIR } from '../../store/paths.js'
import type { NodeJobData } from '../types.js'

const logger = createLogger('workflow-queue')

const LOCK_TIMEOUT_MS = 30_000
const MAX_JOB_ATTEMPTS = 3
const LOCK_RETRY_COUNT = 10
const LOCK_RETRY_DELAY_MS = 100

type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'human_waiting'

interface Job {
  id: string
  name: string
  data: NodeJobData
  status: JobStatus
  priority: number
  delay: number
  attempts: number
  maxAttempts: number
  createdAt: string
  processAt: string
  completedAt?: string
  error?: string
}

interface QueueData {
  jobs: Job[]
  updatedAt: string
}

// 简单的文件锁机制
const LOCK_FILE = `${QUEUE_FILE}.lock`
let lockAcquired = false

function acquireLock(): boolean {
  if (lockAcquired) return true

  try {
    // 检查锁文件是否存在
    if (existsSync(LOCK_FILE)) {
      // 检查锁是否过期（超过 30 秒视为死锁）
      const stat = statSync(LOCK_FILE)
      const age = Date.now() - stat.mtimeMs
      if (age < LOCK_TIMEOUT_MS) {
        return false
      }
      // 锁过期，删除旧锁
      unlinkSync(LOCK_FILE)
    }

    // 创建锁文件
    writeFileSync(LOCK_FILE, process.pid.toString(), { flag: 'wx' })
    lockAcquired = true
    return true
  } catch {
    return false
  }
}

function releaseLock(): void {
  if (!lockAcquired) return

  try {
    if (existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE)
    }
    lockAcquired = false
  } catch {
    // 忽略错误
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withLockAsync<T>(fn: () => T | Promise<T>): Promise<T> {
  const maxRetries = LOCK_RETRY_COUNT
  const retryDelay = LOCK_RETRY_DELAY_MS

  for (let i = 0; i < maxRetries; i++) {
    if (acquireLock()) {
      try {
        return await fn()
      } finally {
        releaseLock()
      }
    }
    // 异步等待后重试
    await sleep(retryDelay)
  }

  throw new Error('Failed to acquire queue lock')
}

// 保留同步版本以便向后兼容
function withLock<T>(fn: () => T): T {
  const maxRetries = LOCK_RETRY_COUNT
  const retryDelay = LOCK_RETRY_DELAY_MS

  for (let i = 0; i < maxRetries; i++) {
    if (acquireLock()) {
      try {
        return fn()
      } finally {
        releaseLock()
      }
    }
    // 同步等待（使用 busy wait，避免 execSync）
    const start = Date.now()
    while (Date.now() - start < retryDelay) {
      // busy wait
    }
  }

  throw new Error('Failed to acquire queue lock')
}

function getQueueData(): QueueData {
  ensureDir(DATA_DIR)
  return (
    readJson<QueueData>(QUEUE_FILE, {
      defaultValue: { jobs: [], updatedAt: new Date().toISOString() },
    }) ?? { jobs: [], updatedAt: new Date().toISOString() }
  )
}

function saveQueueData(data: QueueData): void {
  data.updatedAt = new Date().toISOString()
  writeJson(QUEUE_FILE, data)
}

// 入队节点任务
export async function enqueueNode(
  data: NodeJobData,
  options?: {
    delay?: number
    priority?: number
  }
): Promise<string> {
  return withLockAsync(() => {
    const queueData = getQueueData()

    const jobId = `${data.instanceId}:${data.nodeId}:${data.attempt}`
    const now = new Date()
    const processAt = options?.delay ? new Date(now.getTime() + options.delay) : now

    // 查找是否已存在
    const existingIndex = queueData.jobs.findIndex(j => j.id === jobId)

    const job: Job = {
      id: jobId,
      name: `node:${data.nodeId}`,
      data,
      status: 'waiting',
      priority: options?.priority || 0,
      delay: options?.delay || 0,
      attempts: 0,
      maxAttempts: MAX_JOB_ATTEMPTS,
      createdAt: now.toISOString(),
      processAt: processAt.toISOString(),
    }

    if (existingIndex >= 0) {
      queueData.jobs[existingIndex] = job
    } else {
      queueData.jobs.push(job)
    }

    saveQueueData(queueData)
    logger.debug(`Enqueued node job: ${jobId}`)

    return jobId
  })
}

// 批量入队
export async function enqueueNodes(
  nodes: Array<{
    data: NodeJobData
    options?: { delay?: number; priority?: number }
  }>
): Promise<string[]> {
  return withLockAsync(() => {
    const queueData = getQueueData()
    const ids: string[] = []
    const now = new Date()

    for (const { data, options } of nodes) {
      const jobId = `${data.instanceId}:${data.nodeId}:${data.attempt}`
      const processAt = options?.delay ? new Date(now.getTime() + options.delay) : now

      const job: Job = {
        id: jobId,
        name: `node:${data.nodeId}`,
        data,
        status: 'waiting',
        priority: options?.priority || 0,
        delay: options?.delay || 0,
        attempts: 0,
        maxAttempts: MAX_JOB_ATTEMPTS,
        createdAt: now.toISOString(),
        processAt: processAt.toISOString(),
      }

      const existingIndex = queueData.jobs.findIndex(j => j.id === jobId)
      if (existingIndex >= 0) {
        queueData.jobs[existingIndex] = job
      } else {
        queueData.jobs.push(job)
      }

      ids.push(jobId)
    }

    saveQueueData(queueData)
    logger.debug(`Enqueued ${ids.length} node jobs`)

    return ids
  })
}

// 获取下一个待处理的任务（支持按 instanceId 过滤）
export function getNextJob(instanceId?: string): Job | null {
  return withLock(() => {
    const queueData = getQueueData()
    const now = new Date().toISOString()

    // 过滤出待处理的任务
    let candidates = queueData.jobs.filter(j => j.status === 'waiting' && j.processAt <= now)

    if (instanceId) {
      candidates = candidates.filter(j => j.data.instanceId === instanceId)
    }

    // 按优先级降序、创建时间升序排序
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return a.createdAt.localeCompare(b.createdAt)
    })

    const job = candidates[0]
    if (!job) return null

    // 标记为处理中
    const jobIndex = queueData.jobs.findIndex(j => j.id === job.id)
    const targetJob = queueData.jobs[jobIndex]
    if (!targetJob) return null

    targetJob.status = 'active'
    saveQueueData(queueData)

    return { ...targetJob }
  })
}

// 标记任务完成
export function completeJob(jobId: string): void {
  withLock(() => {
    const queueData = getQueueData()
    const job = queueData.jobs.find(j => j.id === jobId)

    if (job) {
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
      saveQueueData(queueData)
    }
  })
}

// 标记任务失败（带重试逻辑）
export function failJob(jobId: string, error: string): void {
  withLock(() => {
    const queueData = getQueueData()
    const job = queueData.jobs.find(j => j.id === jobId)

    if (!job) return

    if (job.attempts + 1 < job.maxAttempts) {
      // 还有重试机会，重新入队
      const backoffDelay = Math.pow(2, job.attempts) * 1000 // 指数退避
      const processAt = new Date(Date.now() + backoffDelay)

      job.status = 'waiting'
      job.attempts = job.attempts + 1
      job.processAt = processAt.toISOString()
      job.error = error

      logger.debug(`Job ${jobId} will retry after ${backoffDelay}ms`)
    } else {
      // 重试用尽，标记失败
      job.status = 'failed'
      job.completedAt = new Date().toISOString()
      job.error = error
    }

    saveQueueData(queueData)
  })
}

// 直接标记任务失败（不重试）
export function markJobFailed(jobId: string, error: string): void {
  withLock(() => {
    const queueData = getQueueData()
    const job = queueData.jobs.find(j => j.id === jobId)

    if (job) {
      job.status = 'failed'
      job.completedAt = new Date().toISOString()
      job.error = error
      saveQueueData(queueData)
    }

    logger.debug(`Job ${jobId} marked as failed (no retry)`)
  })
}

// 标记任务为等待人工审批（不重试，保持等待状态）
export function markJobWaiting(jobId: string): void {
  withLock(() => {
    const queueData = getQueueData()
    const job = queueData.jobs.find(j => j.id === jobId)

    if (job) {
      job.status = 'human_waiting'
      saveQueueData(queueData)
    }

    logger.debug(`Job ${jobId} marked as waiting for human approval`)
  })
}

// 获取等待审批的任务
export function getWaitingHumanJobs(): Array<{ id: string; data: NodeJobData }> {
  const queueData = getQueueData()

  return queueData.jobs
    .filter(j => j.status === 'human_waiting')
    .map(j => ({ id: j.id, data: j.data }))
}

// 恢复等待中的任务（审批通过后）
export function resumeWaitingJob(jobId: string): void {
  withLock(() => {
    const queueData = getQueueData()
    const job = queueData.jobs.find(j => j.id === jobId && j.status === 'human_waiting')

    if (job) {
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
      saveQueueData(queueData)
    }

    logger.debug(`Job ${jobId} resumed after approval`)
  })
}

// 获取队列统计
export async function getQueueStats(): Promise<{
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}> {
  const queueData = getQueueData()
  const now = new Date().toISOString()

  const stats = {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
  }

  for (const job of queueData.jobs) {
    if (job.status === 'waiting' && job.processAt <= now) {
      stats.waiting++
    } else if (job.status === 'active') {
      stats.active++
    } else if (job.status === 'completed') {
      stats.completed++
    } else if (job.status === 'failed') {
      stats.failed++
    } else if (job.status === 'waiting' && job.processAt > now) {
      stats.delayed++
    }
  }

  return stats
}

// 获取待处理任务列表
export function getWaitingJobs(): Job[] {
  const queueData = getQueueData()
  const now = new Date().toISOString()

  return queueData.jobs
    .filter(j => j.status === 'waiting' && j.processAt <= now)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return a.createdAt.localeCompare(b.createdAt)
    })
}

// 清空队列
export async function drainQueue(): Promise<void> {
  await withLockAsync(() => {
    const queueData = getQueueData()
    queueData.jobs = queueData.jobs.filter(j => j.status !== 'waiting' && j.status !== 'delayed')
    saveQueueData(queueData)
  })

  logger.info('Queue drained')
}

// 关闭队列（清理资源）
export async function closeQueue(): Promise<void> {
  releaseLock()
  logger.info('Queue closed')
}

// 移除特定工作流的所有待处理任务
export async function removeWorkflowJobs(instanceId: string): Promise<number> {
  return withLockAsync(() => {
    const queueData = getQueueData()
    const initialCount = queueData.jobs.length

    queueData.jobs = queueData.jobs.filter(
      j => !((j.status === 'waiting' || j.status === 'delayed') && j.data.instanceId === instanceId)
    )

    const removedCount = initialCount - queueData.jobs.length
    saveQueueData(queueData)

    logger.debug(`Removed ${removedCount} jobs for instance ${instanceId}`)
    return removedCount
  })
}

// 清理已完成的旧任务（保留最近 N 条）
export function cleanupOldJobs(keepCount: number = 100): number {
  return withLock(() => {
    const queueData = getQueueData()

    // 分离出已完成的任务
    const completedJobs = queueData.jobs.filter(
      j => j.status === 'completed' || j.status === 'failed'
    )

    if (completedJobs.length <= keepCount) return 0

    // 按完成时间排序，保留最新的
    completedJobs.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))

    const jobsToKeep = new Set(completedJobs.slice(0, keepCount).map(j => j.id))

    const initialCount = queueData.jobs.length
    queueData.jobs = queueData.jobs.filter(
      j =>
        j.status === 'waiting' ||
        j.status === 'active' ||
        j.status === 'delayed' ||
        j.status === 'human_waiting' ||
        jobsToKeep.has(j.id)
    )

    const removedCount = initialCount - queueData.jobs.length
    if (removedCount > 0) {
      saveQueueData(queueData)
    }

    return removedCount
  })
}
