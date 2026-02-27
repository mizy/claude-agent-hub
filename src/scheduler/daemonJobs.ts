/**
 * Daemon cron job definitions
 *
 * All periodic background jobs run by the daemon:
 * - Task polling — pick up pending tasks from queue
 * - Signal detection — detect and auto-repair issues
 * - Evolution cycle — evolve persona prompts
 * - Waiting task recovery — resume schedule-wait tasks whose timer expired
 */

import cron from 'node-cron'
import chalk from 'chalk'
import { executeTask } from '../task/executeTask.js'
import { pollPendingTask } from '../task/queryTask.js'
import { withProcessTracking } from '../task/processTracking.js'
import { getTasksByStatus, updateTask, getProcessInfo, updateProcessInfo } from '../store/TaskStore.js'
import { getTaskInstance, saveTaskInstance } from '../store/TaskWorkflowStore.js'
import { updateInstanceVariables } from '../store/WorkflowStore.js'
import { resumeTask } from '../task/resumeTask.js'
import { detectSignals, tryAutoRepair } from '../selfevolve/index.js'
import { runEvolutionCycle } from '../prompt-optimization/index.js'
import { BUILTIN_PERSONAS } from '../persona/builtinPersonas.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('daemon-jobs')

let scheduledJobs: cron.ScheduledTask[] = []

/** Register all daemon cron jobs */
export function registerDaemonJobs(pollCronExpr: string): void {
  // Task polling
  const job = cron.schedule(pollCronExpr, async () => {
    try {
      const task = await pollPendingTask()
      if (!task) return
      console.log(chalk.blue(`[${new Date().toLocaleTimeString()}] 执行任务: ${task.title}`))

      await withProcessTracking(task.id, () =>
        executeTask(task, { concurrency: 1, useConsole: false })
      )
    } catch (error) {
      console.error(chalk.red(`执行出错:`), error)
    }
  })
  scheduledJobs.push(job)

  // Signal detection + auto repair — every 30 minutes
  const signalJob = cron.schedule('*/30 * * * *', async () => {
    try {
      const signals = detectSignals()
      if (signals.length === 0) {
        logger.debug('Signal detection: no issues found')
        return
      }
      logger.info(`Signal detection found ${signals.length} signal(s): ${signals.map(s => s.type).join(', ')}`)
      for (const signal of signals) {
        const result = await tryAutoRepair(signal)
        if (result) {
          logger.info(`Auto-repair [${signal.type}]: ${result}`)
        }
      }
    } catch (error) {
      logger.error(`Signal detection cron error: ${error}`)
    }
  })
  scheduledJobs.push(signalJob)

  // Evolution cycle — every hour, for all personas
  const evolutionJob = cron.schedule('0 * * * *', () => {
    try {
      for (const persona of Object.values(BUILTIN_PERSONAS)) {
        const report = runEvolutionCycle(persona.name)
        if (report.activeVersion) {
          logger.debug(
            `Evolution [${persona.name}]: active=v${report.activeVersion.version} ` +
              `(${(report.activeVersion.successRate * 100).toFixed(0)}% success, ${report.activeVersion.totalTasks} tasks), ` +
              `candidates=${report.candidateVersions}, trend=${report.failureTrend}`
          )
        }
      }
    } catch (error) {
      logger.debug(`Evolution cron error: ${error}`)
    }
  })
  scheduledJobs.push(evolutionJob)

  // Recover waiting tasks whose resumeAt has passed — every minute
  const waitingRecoveryJob = cron.schedule('* * * * *', () => {
    try {
      const waitingTasks = getTasksByStatus('waiting')
      for (const task of waitingTasks) {
        const instance = getTaskInstance(task.id)
        if (!instance) continue
        const resumeAt = instance.variables?._scheduleWaitResumeAt
        if (typeof resumeAt !== 'string') continue
        const resumeTime = new Date(resumeAt).getTime()
        if (Date.now() >= resumeTime) {
          logger.info(`Recovering waiting task ${task.id} (resumeAt=${resumeAt} has passed)`)
          // Reset the schedule-wait node from "running" to "pending" so
          // recoverWorkflowInstance can properly re-execute it on resume.
          const waitNodeId = instance.variables?._scheduleWaitNodeId as string | undefined
          const waitNodeStatus = waitNodeId ? instance.nodeStates[waitNodeId]?.status : undefined
          if (waitNodeId && (waitNodeStatus === 'running' || waitNodeStatus === 'waiting')) {
            instance.nodeStates[waitNodeId] = {
              ...instance.nodeStates[waitNodeId],
              status: 'pending',
              attempts: instance.nodeStates[waitNodeId]!.attempts ?? 0,
              startedAt: undefined,
              completedAt: undefined,
            }
            saveTaskInstance(task.id, instance)
          }
          // Clear wait markers and set triggered flag so schedule-wait handler
          // knows to proceed directly instead of recalculating next cron time.
          updateInstanceVariables(instance.id, {
            _scheduleWaitResumeAt: null,
            _scheduleWaitNodeId: null,
            _scheduleWaitTriggered: true,
          })
          // Kill the idle process that's still running from the schedule-wait phase.
          // Use SIGKILL to avoid graceful shutdown — the old process is just idle and
          // its graceful handler would detect the new process's completion and emit
          // a duplicate notification.
          const processInfo = getProcessInfo(task.id)
          if (processInfo?.pid) {
            try {
              process.kill(processInfo.pid, 'SIGKILL')
              logger.debug(`Killed idle schedule-wait process: PID ${processInfo.pid}`)
            } catch {
              // Already dead — fine
            }
            updateProcessInfo(task.id, { status: 'crashed' })
          }

          updateTask(task.id, { status: 'developing' })
          resumeTask(task.id)
        }
      }
    } catch (error) {
      logger.debug(`Waiting task recovery error: ${error}`)
    }
  })
  scheduledJobs.push(waitingRecoveryJob)
}

/** Stop all scheduled jobs */
export function stopAllJobs(): void {
  for (const job of scheduledJobs) {
    job.stop()
  }
  scheduledJobs = []
}
