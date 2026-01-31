#!/usr/bin/env node
/**
 * Background task execution process
 *
 * 作为独立进程运行，执行完整的任务流程：
 * 1. 加载任务
 * 2. 生成 workflow (或恢复已有 workflow)
 * 3. 执行 workflow
 * 4. 保存输出
 *
 * Usage:
 *   node dist/task/runTaskProcess.js --task-id <id> --agent <name>
 *   node dist/task/runTaskProcess.js --task-id <id> --resume   # 恢复模式
 */

import { parseArgs } from 'util'
import { getStore } from '../store/index.js'
import { getOrCreateDefaultAgent } from '../agent/getDefaultAgent.js'
import { runAgentForTask, resumeAgentForTask } from '../agent/runAgentForTask.js'
import {
  getTask,
  updateTask,
  updateProcessInfo,
  getProcessInfo,
} from '../store/TaskStore.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('task-process')

// Heartbeat interval (10 seconds)
const HEARTBEAT_INTERVAL = 10000

// Maximum task execution time (2 hours)
const MAX_TASK_DURATION_MS = 2 * 60 * 60 * 1000

async function main(): Promise<void> {
  // Parse command line arguments
  const { values } = parseArgs({
    options: {
      'task-id': { type: 'string' },
      agent: { type: 'string', default: 'default' },
      resume: { type: 'boolean', default: false },
    },
    strict: true,
  })

  const taskId = values['task-id']
  const agentName = values['agent'] || 'default'
  const isResume = values['resume'] || false

  if (!taskId) {
    console.error('Missing --task-id argument')
    process.exit(1)
  }

  logger.info(`Starting task process: ${taskId}`)
  logger.info(`Agent: ${agentName}`)
  if (isResume) {
    logger.info(`Mode: resume (continuing from failed state)`)
  }

  // Load task
  const task = getTask(taskId)
  if (!task) {
    logger.error(`Task not found: ${taskId}`)
    updateProcessInfo(taskId, { status: 'crashed', error: 'Task not found' })
    process.exit(1)
  }

  // Set up heartbeat to indicate process is alive
  const heartbeat = setInterval(() => {
    const processInfo = getProcessInfo(taskId)
    if (processInfo) {
      updateProcessInfo(taskId, { lastHeartbeat: new Date().toISOString() })
    }
  }, HEARTBEAT_INTERVAL)

  // Set up global timeout (2 hours max)
  const timeoutTimer = setTimeout(() => {
    logger.error(`Task exceeded maximum duration (2 hours), terminating...`)
    updateTask(taskId, { status: 'failed' })
    updateProcessInfo(taskId, {
      status: 'crashed',
      error: 'Task exceeded maximum duration (2 hours)',
    })
    clearInterval(heartbeat)
    process.exit(1)
  }, MAX_TASK_DURATION_MS)

  // Handle process termination
  const cleanup = (signal: string) => {
    logger.info(`Received ${signal}, cleaning up...`)
    clearInterval(heartbeat)
    clearTimeout(timeoutTimer)
    updateProcessInfo(taskId, { status: 'stopped' })
  }

  process.on('SIGTERM', () => cleanup('SIGTERM'))
  process.on('SIGINT', () => cleanup('SIGINT'))

  try {
    // Get or create agent
    const store = getStore()
    let agent = store.getAgent(agentName)
    if (!agent) {
      logger.info(`Agent "${agentName}" not found, using default`)
      agent = await getOrCreateDefaultAgent()
    }

    // Run or resume the task
    if (isResume) {
      await resumeAgentForTask(agent, task)
    } else {
      await runAgentForTask(agent, task)
    }

    // Mark process as stopped
    updateProcessInfo(taskId, { status: 'stopped' })
    logger.info(`Task completed: ${taskId}`)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Task failed: ${errorMessage}`)

    // Update task status
    updateTask(taskId, { status: 'failed' })

    // Update process info
    updateProcessInfo(taskId, {
      status: 'crashed',
      error: errorMessage,
    })

    process.exit(1)
  } finally {
    clearInterval(heartbeat)
    clearTimeout(timeoutTimer)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
