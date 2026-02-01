/**
 * Spawn task as background process
 *
 * 使用 spawn + detach + unref 让 CLI 立即返回
 * 后台进程独立运行，执行完整的 workflow 流程
 */

import { spawn } from 'child_process'
import { openSync, closeSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const currentDir = dirname(fileURLToPath(import.meta.url))
import { createLogger } from '../shared/logger.js'
import {
  createTaskFolder,
  saveProcessInfo,
  isProcessRunning,
  type ProcessInfo,
} from '../store/TaskStore.js'
import { getLogPath } from '../store/TaskLogStore.js'
import { RUNNER_LOCK_FILE, DATA_DIR } from '../store/paths.js'
import { mkdirSync } from 'fs'

const logger = createLogger('spawn-task')

export interface SpawnTaskOptions {
  taskId: string
  resume?: boolean  // 是否为恢复模式
}

/**
 * Spawn task execution as a detached background process
 * @returns Process ID
 */
export function spawnTaskProcess(options: SpawnTaskOptions): number {
  const { taskId, resume = false } = options

  // Ensure task folder exists
  createTaskFolder(taskId)

  // Create log file for process output
  const logPath = getLogPath(taskId)
  const out = openSync(logPath, 'a')
  const err = openSync(logPath, 'a')

  // Find the runTaskProcess script path (relative to this file's location)
  const scriptPath = join(currentDir, 'runTaskProcess.js')

  const args = [
    scriptPath,
    '--task-id',
    taskId,
  ]

  // Add resume flag if needed
  if (resume) {
    args.push('--resume')
  }

  logger.debug(`Spawning task process: ${taskId}`)
  logger.debug(`Script: ${scriptPath}`)
  logger.debug(`Log: ${logPath}`)
  logger.debug(`Resume mode: ${resume}`)

  // Spawn detached process
  const child = spawn(
    process.execPath, // node
    args,
    {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: process.cwd(),
      env: {
        ...process.env,
        CAH_TASK_ID: taskId,
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

/**
 * 检查是否有 runner 在运行
 */
function isRunnerRunning(): boolean {
  if (!existsSync(RUNNER_LOCK_FILE)) {
    return false
  }
  try {
    const pid = parseInt(readFileSync(RUNNER_LOCK_FILE, 'utf-8').trim(), 10)
    if (isNaN(pid)) return false
    return isProcessRunning(pid)
  } catch {
    return false
  }
}

/**
 * 创建 runner 锁文件
 */
function createRunnerLock(pid: number): void {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(RUNNER_LOCK_FILE, String(pid))
}

/**
 * 释放 runner 锁文件
 */
export function releaseRunnerLock(): void {
  try {
    if (existsSync(RUNNER_LOCK_FILE)) {
      unlinkSync(RUNNER_LOCK_FILE)
    }
  } catch {
    // ignore
  }
}

/**
 * Spawn task queue runner as background process
 * 执行队列中所有 pending 任务（串行）
 * 如果已有 runner 在运行，则跳过
 */
export function spawnTaskRunner(): void {
  // 检查是否已有 runner 在运行
  if (isRunnerRunning()) {
    logger.debug('Queue runner already running, skip')
    return
  }

  const scriptPath = join(currentDir, 'runQueueProcess.js')

  logger.debug(`Spawning queue runner: ${scriptPath}`)

  const child = spawn(
    process.execPath,
    [scriptPath],
    {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
    }
  )

  child.unref()

  // 写入锁文件
  if (child.pid) {
    createRunnerLock(child.pid)
  }

  logger.debug(`Queue runner spawned: PID ${child.pid}`)
}
