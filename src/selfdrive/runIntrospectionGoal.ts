import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { DriveGoal } from './goals.js'
import { markGoalRun } from './goals.js'
import { runDailyReflection } from '../consciousness/reflectionRunner.js'
import { runWeeklyNarrative } from '../consciousness/narrativeRunner.js'

const logger = createLogger('selfdrive')

const INTROSPECTION_HANDLERS: Record<string, () => Promise<void>> = {
  runDailyReflection,
  runWeeklyNarrative,
}

export async function executeIntrospectionGoal(goal: DriveGoal): Promise<void> {
  const handlerName = goal.handler
  if (!handlerName) {
    logger.warn(`Introspection goal ${goal.id} has no handler`)
    markGoalRun(goal.id, 'failure', 'No handler specified')
    return
  }

  const handler = INTROSPECTION_HANDLERS[handlerName]
  if (!handler) {
    logger.warn(`Unknown introspection handler: ${handlerName}`)
    markGoalRun(goal.id, 'failure', `Unknown handler: ${handlerName}`)
    return
  }

  try {
    logger.info(`Running introspection handler: ${handlerName}`)
    await handler()
    markGoalRun(goal.id, 'success')
    logger.info(`Introspection handler ${handlerName} completed`)
  } catch (error) {
    const message = getErrorMessage(error)
    logger.error(`Introspection handler ${handlerName} failed: ${message}`)
    markGoalRun(goal.id, 'failure', message)
  }
}
