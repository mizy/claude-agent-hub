/**
 * Queue maintenance operations
 * Stats, cleanup, drain, and close
 */

import { createLogger } from '../../shared/logger.js'
import {
  getQueueData,
  saveQueueData,
  releaseLock,
  withLock,
  withLockAsync,
  type Job,
} from './queueLock.js'

const logger = createLogger('queue-maintenance')

/**
 * Get queue statistics
 */
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

/**
 * Get list of waiting jobs (ready to process)
 */
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

/**
 * Drain queue (remove all waiting/delayed jobs)
 */
export async function drainQueue(): Promise<void> {
  await withLockAsync(() => {
    const queueData = getQueueData()
    queueData.jobs = queueData.jobs.filter(j => j.status !== 'waiting' && j.status !== 'delayed')
    saveQueueData(queueData)
  })

  logger.info('Queue drained')
}

/**
 * Close queue (release resources)
 */
export async function closeQueue(): Promise<void> {
  releaseLock()
  logger.info('Queue closed')
}

/**
 * Remove all pending jobs for a specific workflow instance
 */
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

/**
 * Cleanup old completed/failed jobs (keep most recent N)
 */
export function cleanupOldJobs(keepCount: number = 100): number {
  return withLock(() => {
    const queueData = getQueueData()

    const completedJobs = queueData.jobs.filter(
      j => j.status === 'completed' || j.status === 'failed'
    )

    if (completedJobs.length <= keepCount) return 0

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
