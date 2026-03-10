import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { createTaskWithFolder } from '../task/createTaskWithFolder.js'
import { spawnTaskRunner } from '../task/spawnTask.js'
import { getAllTasks } from '../store/TaskStore.js'
import { detectSignals } from '../selfevolve/signalDetector.js'
import { hasRunningSelfdriveTask } from './hasRunningSelfdriveTask.js'
import { buildSignalEvolutionPrompt } from './buildGoalPrompt.js'

const logger = createLogger('selfdrive')

export async function runSignalDetection(signalWindowMs: number): Promise<void> {
  try {
    const recentTasks = getAllTasks().filter(t => {
      if (t.status !== 'completed' && t.status !== 'failed') return false
      const age = Date.now() - new Date(t.updatedAt || t.createdAt).getTime()
      return age < signalWindowMs
    })
    if (recentTasks.length === 0) {
      logger.debug('No recent completed/failed tasks, skipping signal detection')
      return
    }

    const signals = detectSignals()
    const actionable = signals.filter(s => s.severity === 'critical' || s.severity === 'warning')

    if (actionable.length === 0) return

    logger.info(`Signal detection found ${actionable.length} actionable signal(s)`)

    if (hasRunningSelfdriveTask('signal-evolve')) {
      logger.info('Skipping signal-triggered evolution: one already running')
      return
    }

    const signal = actionable.find(s => s.severity === 'critical') ?? actionable[0]!
    const label = `${signal.type} x${signal.count}`

    logger.info(`Triggering signal evolution: ${label}`)

    const task = createTaskWithFolder({
      title: `[信号触发] ${label}`,
      description: buildSignalEvolutionPrompt(signal),
      source: 'selfdrive',
      metadata: { goalType: 'signal-evolve', signalType: signal.type },
    })

    logger.info(`Created signal-triggered evolution task: ${task.id}`)
    spawnTaskRunner()
  } catch (error) {
    logger.error(`Signal detection failed: ${getErrorMessage(error)}`)
  }
}
