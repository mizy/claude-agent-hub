/**
 * Workflow task queue
 * Core queue operations: enqueue, dequeue, complete, fail
 *
 * Human approval: see HumanApprovalQueue.ts
 * Maintenance (stats, cleanup, drain): see queueMaintenance.ts
 */

import { createLogger } from '../../shared/logger.js'
import {
  getQueueData,
  saveQueueData,
  withLock,
  withLockAsync,
  type Job,
} from './queueLock.js'
import type { NodeJobData } from '../types.js'

const logger = createLogger('workflow-queue')

const MAX_JOB_ATTEMPTS = 3

// ============ Core Queue Operations ============

function createJob(
  data: NodeJobData,
  now: Date,
  options?: { delay?: number; priority?: number }
): Job {
  const processAt = options?.delay ? new Date(now.getTime() + options.delay) : now
  return {
    id: `${data.instanceId}:${data.nodeId}:${data.attempt}`,
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
}

function upsertJob(queueData: { jobs: Job[] }, job: Job): void {
  const existingIndex = queueData.jobs.findIndex(j => j.id === job.id)
  if (existingIndex >= 0) {
    queueData.jobs[existingIndex] = job
  } else {
    queueData.jobs.push(job)
  }
}

/**
 * Enqueue a single node job
 */
export async function enqueueNode(
  data: NodeJobData,
  options?: { delay?: number; priority?: number }
): Promise<string> {
  return withLockAsync(() => {
    const queueData = getQueueData()
    const job = createJob(data, new Date(), options)
    upsertJob(queueData, job)
    saveQueueData(queueData)
    logger.debug(`Enqueued node job: ${job.id}`)
    return job.id
  })
}

/**
 * Batch enqueue node jobs
 */
export async function enqueueNodes(
  nodes: Array<{
    data: NodeJobData
    options?: { delay?: number; priority?: number }
  }>
): Promise<string[]> {
  return withLockAsync(() => {
    const queueData = getQueueData()
    const now = new Date()
    const ids: string[] = []

    for (const { data, options } of nodes) {
      const job = createJob(data, now, options)
      upsertJob(queueData, job)
      ids.push(job.id)
    }

    saveQueueData(queueData)
    logger.debug(`Enqueued ${ids.length} node jobs`)
    return ids
  })
}

/**
 * Get next job ready for processing (optionally filtered by instanceId)
 */
export function getNextJob(instanceId?: string): Job | null {
  return withLock(() => {
    const queueData = getQueueData()
    const now = new Date().toISOString()

    let candidates = queueData.jobs.filter(j => j.status === 'waiting' && j.processAt <= now)

    if (instanceId) {
      candidates = candidates.filter(j => j.data.instanceId === instanceId)
    }

    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return a.createdAt.localeCompare(b.createdAt)
    })

    const job = candidates[0]
    if (!job) return null

    const jobIndex = queueData.jobs.findIndex(j => j.id === job.id)
    const targetJob = queueData.jobs[jobIndex]
    if (!targetJob) return null

    targetJob.status = 'active'
    saveQueueData(queueData)

    return { ...targetJob }
  })
}

/**
 * Mark job as completed
 */
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

/**
 * Mark job as failed (with retry logic)
 */
export function failJob(jobId: string, error: string): void {
  withLock(() => {
    const queueData = getQueueData()
    const job = queueData.jobs.find(j => j.id === jobId)

    if (!job) return

    if (job.attempts + 1 < job.maxAttempts) {
      const backoffDelay = Math.pow(2, job.attempts) * 1000
      const processAt = new Date(Date.now() + backoffDelay)

      job.status = 'waiting'
      job.attempts = job.attempts + 1
      job.processAt = processAt.toISOString()
      job.error = error

      logger.debug(`Job ${jobId} will retry after ${backoffDelay}ms`)
    } else {
      job.status = 'failed'
      job.completedAt = new Date().toISOString()
      job.error = error
    }

    saveQueueData(queueData)
  })
}

/**
 * Mark job as permanently failed (no retry)
 */
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

// ============ Re-exports for backward compatibility ============

export {
  markJobWaiting,
  getWaitingHumanJobs,
  resumeWaitingJob,
  resumeWaitingJobsForInstance,
} from './HumanApprovalQueue.js'

export {
  getQueueStats,
  getWaitingJobs,
  drainQueue,
  closeQueue,
  removeWorkflowJobs,
  cleanupOldJobs,
} from './queueMaintenance.js'
