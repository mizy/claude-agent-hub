/**
 * Stop/cancel a running task
 */

import { getStore } from '../store/index.js'
import { createLogger } from '../shared/logger.js'
import type { Task } from '../types/task.js'

const logger = createLogger('task')

export interface StopTaskResult {
  success: boolean
  task?: Task
  error?: string
}

/**
 * Stop a running task by ID
 * Changes status to 'cancelled' and releases the agent
 */
export function stopTask(id: string): StopTaskResult {
  const store = getStore()
  const task = store.getTask(id)

  if (!task) {
    return { success: false, error: `Task not found: ${id}` }
  }

  // Check if task can be stopped
  const stoppableStatuses = ['pending', 'planning', 'developing', 'reviewing']
  if (!stoppableStatuses.includes(task.status)) {
    return {
      success: false,
      error: `Task is already ${task.status}, cannot stop`,
    }
  }

  // Release the agent if assigned
  if (task.assignee) {
    const agent = store.getAgent(task.assignee)
    if (agent && agent.currentTask === task.id) {
      store.updateAgent(task.assignee, {
        status: 'idle',
        currentTask: undefined,
      })
      logger.info(`Released agent: ${task.assignee}`)
    }
  }

  // Update task status
  store.updateTask(task.id, { status: 'cancelled' })
  logger.info(`Stopped task: ${task.id}`)

  // Return updated task
  const updatedTask = store.getTask(task.id)
  return { success: true, task: updatedTask ?? task }
}
