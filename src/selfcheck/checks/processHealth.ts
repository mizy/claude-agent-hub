import { getPidLock, isProcessRunning } from '../../scheduler/pidLock.js'
import { getTasksByStatus, getProcessInfo } from '../../store/TaskStore.js'
import type { TaskStatus } from '../../types/task.js'
import type { HealthCheck, CheckResult, Diagnosis } from '../types.js'

const RUNNING_STATUSES: TaskStatus[] = ['planning', 'developing']

export const processHealthCheck: HealthCheck = {
  name: 'process-health',
  description: 'Check daemon and task processes for orphans and stale locks',
  async run() {
    const details: string[] = []
    let score = 100

    // Check daemon
    const daemonLock = getPidLock('daemon')
    if (daemonLock) {
      if (!isProcessRunning(daemonLock.pid)) {
        score -= 20
        details.push(`Daemon PID ${daemonLock.pid} is not running (stale lock)`)
      } else {
        details.push(`Daemon running (PID ${daemonLock.pid})`)
      }
    } else {
      details.push('Daemon not started')
    }

    // Check orphan tasks and PID conflicts
    const runningTasks = RUNNING_STATUSES.flatMap((s) => getTasksByStatus(s))
    const pidToTasks = new Map<number, string[]>()
    let orphanCount = 0
    const orphanTaskIds: string[] = []

    for (const task of runningTasks) {
      const processInfo = getProcessInfo(task.id)
      if (!processInfo) {
        orphanCount++
        orphanTaskIds.push(task.id)
        details.push(`Orphan: ${task.id} has no process.json`)
        continue
      }

      if (!isProcessRunning(processInfo.pid)) {
        orphanCount++
        orphanTaskIds.push(task.id)
        details.push(`Orphan: ${task.id} PID ${processInfo.pid} not running`)
      }

      // Track PID for conflict detection
      const existing = pidToTasks.get(processInfo.pid) || []
      existing.push(task.id)
      pidToTasks.set(processInfo.pid, existing)
    }

    // Check PID conflicts
    let conflictCount = 0
    for (const [pid, tasks] of pidToTasks) {
      if (tasks.length > 1) {
        conflictCount++
        details.push(`PID conflict: PID ${pid} claimed by ${tasks.join(', ')}`)
      }
    }

    score -= orphanCount * 15
    score -= conflictCount * 10
    score = Math.max(0, score)

    const status = score >= 80 ? (score === 100 ? 'pass' : 'warning') : 'fail'

    let diagnosis: Diagnosis | undefined
    if (orphanCount > 0) {
      diagnosis = {
        category: 'process_error',
        rootCause: `${orphanCount} task(s) are in running state but their processes are dead`,
        suggestedFix: 'Resume orphaned tasks (cah selfcheck --fix)',
      }
    } else if (conflictCount > 0) {
      diagnosis = {
        category: 'process_error',
        rootCause: `${conflictCount} PID conflict(s) — multiple tasks claim the same process`,
        suggestedFix: 'Investigate conflicting tasks manually and stop duplicates',
      }
    }

    const result: CheckResult = {
      name: this.name,
      status,
      score,
      details,
      fixable: orphanTaskIds.length > 0,
      diagnosis,
    }

    if (orphanTaskIds.length > 0) {
      result.fix = async () => {
        const { resumeAllOrphanedTasks } = await import('../../task/resumeTask.js')
        const resumed = resumeAllOrphanedTasks()
        return `Recovered ${resumed.length} orphaned task(s)`
      }
    }

    return result
  },
}
