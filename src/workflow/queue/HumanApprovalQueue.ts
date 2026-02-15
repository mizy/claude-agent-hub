/**
 * Human approval queue management
 * Handles human_waiting job status for approval workflows
 */

import { createLogger } from '../../shared/logger.js'
import type { NodeJobData } from '../types.js'
import { getQueueData, saveQueueData, withLock } from './queueLock.js'

const logger = createLogger('human-approval-queue')

/**
 * Mark a job as waiting for human approval (no retry, hold status)
 */
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

/**
 * Get all jobs waiting for human approval
 */
export function getWaitingHumanJobs(): Array<{ id: string; data: NodeJobData }> {
  const queueData = getQueueData()

  return queueData.jobs
    .filter(j => j.status === 'human_waiting')
    .map(j => ({ id: j.id, data: j.data }))
}

/**
 * Resume a waiting job after approval (mark as completed)
 */
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

/**
 * Re-activate all human_waiting jobs for a given instance.
 * Used when resuming from autoWait pause — sets jobs back to 'waiting'
 * so the NodeWorker picks them up again.
 */
export function resumeWaitingJobsForInstance(instanceId: string): number {
  let count = 0
  withLock(() => {
    const queueData = getQueueData()
    for (const job of queueData.jobs) {
      if (job.status === 'human_waiting' && job.data.instanceId === instanceId) {
        job.status = 'waiting'
        count++
      }
    }
    if (count > 0) {
      saveQueueData(queueData)
      logger.info(`Resumed ${count} waiting job(s) for instance ${instanceId}`)
    }
  })
  return count
}
