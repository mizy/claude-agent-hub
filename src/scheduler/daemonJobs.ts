/**
 * Daemon cron job definitions
 *
 * All periodic background jobs run by the daemon:
 * - Task polling — pick up pending tasks from queue
 * - Signal detection — detect and auto-repair issues
 * - Evolution cycle — evolve agent prompts
 * - Waiting task recovery — resume schedule-wait tasks whose timer expired
 */

import cron from 'node-cron'
import chalk from 'chalk'
import { readdirSync, statSync, unlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../store/paths.js'
import { executeTask } from '../task/executeTask.js'
import { pollPendingTask } from '../task/queryTask.js'
import { withProcessTracking } from '../task/processTracking.js'
import { getTasksByStatus, updateTask, getProcessInfo, updateProcessInfo } from '../store/TaskStore.js'
import { getTaskInstance, saveTaskInstance } from '../store/TaskWorkflowStore.js'
import { updateInstanceVariables } from '../store/WorkflowStore.js'
import { resumeTask, detectOrphanedTasks } from '../task/resumeTask.js'
import { detectSignals, tryAutoRepair } from '../selfevolve/index.js'
import { runEvolutionCycle } from '../prompt-optimization/index.js'
import { BUILTIN_AGENTS } from '../agents/builtinAgents.js'
import { cleanupFadingMemories, consolidateMemories, rebuildAllAssociations, runTierPromotion } from '../memory/index.js'
import { loadConfig } from '../config/loadConfig.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('daemon-jobs')

const MAX_WAITING_RESUME_ATTEMPTS = 5
const waitingResumeAttempts = new Map<string, number>()

let scheduledJobs: cron.ScheduledTask[] = []

/** Poll and execute the next pending task */
async function pollAndExecute(): Promise<void> {
  try {
    const task = await pollPendingTask()
    if (!task) return
    console.log(chalk.blue(`[${new Date().toLocaleTimeString()}] 执行任务: ${task.title}`))

    await withProcessTracking(task.id, () =>
      executeTask(task, { useConsole: false })
    )
  } catch (error) {
    console.error(chalk.red(`执行出错:`), error)
  }
}

/** Register all daemon cron jobs */
export async function registerDaemonJobs(pollCronExpr: string): Promise<void> {
  // Task polling
  const job = cron.schedule(pollCronExpr, pollAndExecute)
  scheduledJobs.push(job)

  // Immediately poll once on startup (don't await — run in background)
  pollAndExecute()

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

  // Evolution cycle — every hour, for all agents
  const evolutionJob = cron.schedule('0 * * * *', () => {
    try {
      for (const agent of Object.values(BUILTIN_AGENTS)) {
        const report = runEvolutionCycle(agent.name)
        if (report.activeVersion) {
          logger.debug(
            `Evolution [${agent.name}]: active=v${report.activeVersion.version} ` +
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
          const attempts = (waitingResumeAttempts.get(task.id) ?? 0) + 1
          waitingResumeAttempts.set(task.id, attempts)
          if (attempts > MAX_WAITING_RESUME_ATTEMPTS) {
            logger.warn(`Task ${task.id} exceeded max waiting resume attempts (${MAX_WAITING_RESUME_ATTEMPTS}), marking as failed`)
            updateTask(task.id, { status: 'failed', error: `Exceeded max waiting resume attempts (${MAX_WAITING_RESUME_ATTEMPTS}). Schedule-wait node could not recover.` })
            waitingResumeAttempts.delete(task.id)
            continue
          }
          logger.info(`Recovering waiting task ${task.id} (resumeAt=${resumeAt} has passed, attempt ${attempts}/${MAX_WAITING_RESUME_ATTEMPTS})`)
          // Reset the schedule-wait node from "running" to "pending" so
          // recoverWorkflowInstance can properly re-execute it on resume.
          const waitNodeId = instance.variables?._scheduleWaitNodeId as string | undefined
          const waitNodeStatus = waitNodeId ? instance.nodeStates[waitNodeId]?.status : undefined
          if (waitNodeId && (waitNodeStatus === 'running' || waitNodeStatus === 'waiting' || waitNodeStatus === 'failed')) {
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
          const resumed = resumeTask(task.id)
          if (resumed) waitingResumeAttempts.delete(task.id)
        }
      }
    } catch (error) {
      logger.warn(`Waiting task recovery error: ${error}`)
    }
  })
  scheduledJobs.push(waitingRecoveryJob)

  // Orphan recovery — every 5 minutes, detect and resume stuck/orphaned tasks
  // Covers tasks that were running in-process when daemon was interrupted,
  // or tasks stuck in developing with no active process.
  const orphanRecoveryJob = cron.schedule('*/5 * * * *', () => {
    try {
      const orphaned = detectOrphanedTasks()
      if (orphaned.length === 0) return

      logger.info(`Orphan recovery: found ${orphaned.length} orphaned task(s)`)
      for (const { task } of orphaned) {
        const pid = resumeTask(task.id)
        if (pid) {
          logger.info(`Orphan recovery: resumed task ${task.id} (PID ${pid})`)
        } else {
          logger.warn(`Orphan recovery: skipped task ${task.id} (already active or completed)`)
        }
      }
    } catch (error) {
      logger.error(`Orphan recovery cron error: ${error}`)
    }
  })
  scheduledJobs.push(orphanRecoveryJob)

  // Memory fading cleanup — configurable interval (default every hour)
  const config = await loadConfig()
  const cleanupHours = config.memory?.forgetting?.cleanupIntervalHours ?? 1
  const memoryCleanupJob = cron.schedule(`0 */${cleanupHours} * * *`, async () => {
    try {
      const result = await cleanupFadingMemories()
      if (result.archived > 0 || result.deleted > 0) {
        logger.info(`Memory cleanup: archived=${result.archived}, deleted=${result.deleted}`)
      }
    } catch (error) {
      logger.error(`Memory cleanup cron error: ${error}`)
    }
  })
  scheduledJobs.push(memoryCleanupJob)

  // Memory consolidation — daily at 3:00 AM
  const memoryConsolidationJob = cron.schedule('0 3 * * *', async () => {
    try {
      const result = await consolidateMemories()
      logger.info(`Memory consolidation: merged=${result.merged}, kept=${result.kept}`)
    } catch (error) {
      logger.error(`Memory consolidation cron error: ${error}`)
    }
  })
  scheduledJobs.push(memoryConsolidationJob)

  // Association graph rebuild — weekly on Sunday at 4:00 AM
  const associationRebuildJob = cron.schedule('0 4 * * 0', async () => {
    try {
      const result = await rebuildAllAssociations()
      logger.info(`Association rebuild: total=${result.total}, newLinks=${result.newLinks}`)
    } catch (error) {
      logger.error(`Association rebuild cron error: ${error}`)
    }
  })
  scheduledJobs.push(associationRebuildJob)

  // Tier promotion — periodic ranking-based promotion/demotion
  const tierPromotionHours = config.memory?.tiers?.promotionIntervalHours ?? 1
  const tierPromotionJob = cron.schedule(`0 */${tierPromotionHours} * * *`, async () => {
    try {
      const result = await runTierPromotion()
      if (result.promoted > 0 || result.demoted > 0 || result.archived > 0) {
        logger.info(`Tier promotion: promoted=${result.promoted}, demoted=${result.demoted}, archived=${result.archived}`)
      }
    } catch (error) {
      logger.error(`Tier promotion cron error: ${error}`)
    }
  })
  scheduledJobs.push(tierPromotionJob)

  // Tmp file cleanup — every hour, delete files older than 24h
  const tmpCleanupJob = cron.schedule('0 * * * *', () => {
    try {
      const tmpDir = join(DATA_DIR, 'tmp')
      const cutoff = Date.now() - 24 * 60 * 60 * 1000
      let deleted = 0
      for (const name of readdirSync(tmpDir)) {
        const filePath = join(tmpDir, name)
        try {
          const stat = statSync(filePath)
          if (stat.mtimeMs < cutoff) {
            if (stat.isDirectory()) {
              rmSync(filePath, { recursive: true, force: true })
            } else {
              unlinkSync(filePath)
            }
            deleted++
          }
        } catch { /* skip */ }
      }
      if (deleted > 0) logger.debug(`Tmp cleanup: deleted ${deleted} file(s) from ${tmpDir}`)
    } catch { /* dir may not exist yet */ }
  })
  scheduledJobs.push(tmpCleanupJob)
}

/** Stop all scheduled jobs */
export function stopAllJobs(): void {
  for (const job of scheduledJobs) {
    job.stop()
  }
  scheduledJobs = []
}
