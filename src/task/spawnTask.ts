/**
 * Spawn task as background process
 *
 * 使用 spawn + detach + unref 让 CLI 立即返回
 * 后台进程独立运行，执行完整的 workflow 流程
 */

import { spawn } from 'child_process'
import { openSync, closeSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../shared/logger.js'
import {
  getTaskFolder,
  createTaskFolder,
  saveProcessInfo,
  getLogPath,
  type ProcessInfo,
} from '../store/TaskStore.js'

const logger = createLogger('spawn-task')

export interface SpawnTaskOptions {
  taskId: string
  agentName?: string
}

/**
 * Spawn task execution as a detached background process
 * @returns Process ID
 */
export function spawnTaskProcess(options: SpawnTaskOptions): number {
  const { taskId, agentName = 'default' } = options

  // Ensure task folder exists
  const taskDir = getTaskFolder(taskId)
  createTaskFolder(taskId)

  // Create log file for process output
  const logPath = getLogPath(taskId)
  const out = openSync(logPath, 'a')
  const err = openSync(logPath, 'a')

  // Find the runTaskProcess script path
  const scriptPath = join(process.cwd(), 'dist/task/runTaskProcess.js')

  logger.debug(`Spawning task process: ${taskId}`)
  logger.debug(`Script: ${scriptPath}`)
  logger.debug(`Log: ${logPath}`)

  // Spawn detached process
  const child = spawn(
    process.execPath, // node
    [
      scriptPath,
      '--task-id',
      taskId,
      '--agent',
      agentName,
    ],
    {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: process.cwd(),
      env: {
        ...process.env,
        CAH_TASK_ID: taskId,
        CAH_AGENT: agentName,
      },
    }
  )

  // Close file descriptors in parent
  closeSync(out)
  closeSync(err)

  // Allow CLI to exit
  child.unref()

  const pid = child.pid!

  // Save process info
  const processInfo: ProcessInfo = {
    pid,
    startedAt: new Date().toISOString(),
    status: 'running',
  }
  saveProcessInfo(taskId, processInfo)

  logger.info(`Task process spawned: PID ${pid}`)

  return pid
}
