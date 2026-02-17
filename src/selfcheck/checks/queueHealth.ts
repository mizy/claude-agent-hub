import { existsSync, readFileSync, writeFileSync } from 'fs'
import { QUEUE_FILE } from '../../store/paths.js'
import type { HealthCheck, Diagnosis } from '../types.js'

export const queueHealthCheck: HealthCheck = {
  name: 'queue-health',
  description: 'Check queue.json validity and consistency with task data',
  async run() {
    const details: string[] = []
    let score = 100

    if (!existsSync(QUEUE_FILE)) {
      details.push('No queue.json found (normal if no tasks queued)')
      return { name: this.name, status: 'pass', score: 100, details, fixable: false }
    }

    // Parse queue.json
    let queue: unknown
    try {
      queue = JSON.parse(readFileSync(QUEUE_FILE, 'utf-8'))
    } catch {
      score -= 40
      details.push('queue.json is corrupt (invalid JSON)')
      return { name: this.name, status: 'fail', score, details, fixable: false }
    }

    // Validate structure: queue.json is { jobs: [...], updatedAt: string }
    const queueObj = queue as Record<string, unknown>
    const jobs = Array.isArray(queue) ? queue : Array.isArray(queueObj?.jobs) ? queueObj.jobs as unknown[] : null

    if (!jobs) {
      score -= 30
      details.push('queue.json has invalid structure (expected { jobs: [...] } or array)')
      return { name: this.name, status: 'fail', score, details, fixable: false }
    }

    // Check each job entry
    let staleJobs = 0
    const activeJobs: string[] = []
    for (const entry of jobs) {
      if (!entry || typeof entry !== 'object') {
        score -= 5
        details.push('Queue contains non-object entry')
        continue
      }
      const job = entry as Record<string, unknown>
      const jobStatus = job.status as string | undefined
      const jobId = job.id as string | undefined

      if (jobStatus === 'active' || jobStatus === 'waiting') {
        activeJobs.push(jobId ?? 'unknown')
      }
      if (jobStatus === 'completed') {
        staleJobs++
      }
    }

    if (activeJobs.length > 0) {
      details.push(`${activeJobs.length} active/waiting job(s): ${activeJobs.join(', ')}`)
    }
    let diagnosis: Diagnosis | undefined
    if (staleJobs > 0) {
      score -= 5
      details.push(`${staleJobs} completed job(s) in queue (should be pruned)`)
      diagnosis = {
        category: 'corrupt_data',
        rootCause: `Queue has ${staleJobs} completed job(s) that should have been cleaned up`,
        suggestedFix: 'Prune completed jobs from queue (cah selfcheck --fix)',
      }
    }
    if (jobs.length === 0) {
      details.push('Queue is empty')
    } else {
      details.push(`Queue has ${jobs.length} total entries`)
    }

    score = Math.max(0, score)
    const needsFix = staleJobs > 0
    const status = score >= 80 ? (score === 100 ? 'pass' : 'warning') : 'fail'

    return {
      name: this.name,
      status,
      score,
      details,
      fixable: needsFix,
      fix: needsFix ? () => pruneCompletedJobs(queue, jobs, staleJobs) : undefined,
      diagnosis,
    }
  },
}

async function pruneCompletedJobs(queue: unknown, jobs: unknown[], staleCount: number): Promise<string> {
  const filtered = jobs.filter(entry => {
    if (!entry || typeof entry !== 'object') return true
    return (entry as Record<string, unknown>).status !== 'completed'
  })

  // Preserve queue structure (object with jobs array, or plain array)
  const queueObj = queue as Record<string, unknown>
  const isWrapped = !Array.isArray(queue) && Array.isArray(queueObj?.jobs)

  const updated = isWrapped
    ? { ...queueObj, jobs: filtered, updatedAt: new Date().toISOString() }
    : filtered

  writeFileSync(QUEUE_FILE, JSON.stringify(updated, null, 2) + '\n')
  return `Pruned ${staleCount} completed job(s) from queue`
}
