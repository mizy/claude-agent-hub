import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { createTaskWithFolder } from '../task/createTaskWithFolder.js'
import { spawnTaskRunner } from '../task/spawnTask.js'
import { markGoalRun, type DriveGoal } from './goals.js'
import { hasRunningSelfdriveTask } from './hasRunningSelfdriveTask.js'
import { getGoalPrompt } from './buildGoalPrompt.js'
import { executeIntrospectionGoal } from './runIntrospectionGoal.js'

// Note: markGoalRun is no longer called here on success.
// It is called by registerSelfdriveListeners (via task:completed event)
// so that goal status reflects actual task outcome.

const logger = createLogger('selfdrive')

const GOAL_TASK_DESCRIPTIONS: Record<string, string> = {
  'evolve': '[自驱] 全局自进化',
  'evolve-feature': '[自驱] 外部灵感采集',
  'cleanup-code': '[自驱] 代码与文档清理',
  'update-docs': '[自驱] 项目文档更新',
}

export async function executeGoal(goal: DriveGoal): Promise<void> {
  logger.info(`Executing goal: ${goal.type} (${goal.description})`)

  if (goal.type === 'introspection') {
    await executeIntrospectionGoal(goal)
    return
  }

  const description = GOAL_TASK_DESCRIPTIONS[goal.type]
  if (!description) {
    logger.warn(`Unknown goal type: ${goal.type}`)
    markGoalRun(goal.id, 'failure', `Unknown goal type: ${goal.type}`)
    return
  }

  if (hasRunningSelfdriveTask(goal.type)) {
    logger.info(`Skipping goal ${goal.id} (${goal.type}): selfdrive task of same type already running`)
    return
  }

  try {
    const prompt = getGoalPrompt(goal.type) ?? description
    const task = createTaskWithFolder({
      title: description,
      description: prompt,
      source: 'selfdrive',
      metadata: { goalId: goal.id, goalType: goal.type },
    })

    logger.info(`Created selfdrive task: ${task.id} (${goal.type})`)
    spawnTaskRunner()
    // markGoalRun deferred to task:completed event listener (registerSelfdriveListeners)
  } catch (error) {
    const message = getErrorMessage(error)
    logger.error(`Goal ${goal.type} failed to create task: ${message}`)
    markGoalRun(goal.id, 'failure', message)
  }
}
