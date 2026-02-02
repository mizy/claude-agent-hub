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
import { RUNNER_LOCK_FILE, RUNNER_LOG_FILE, DATA_DIR } from '../store/paths.js'
import { mkdirSync } from 'fs'

const logger = createLogger('spawn-task')

const isMac = process.platform === 'darwin'

/**
 * 启动 caffeinate 防止 Mac 休眠
 * caffeinate -w <pid> 会在指定进程运行期间阻止系统休眠
 */
function spawnCaffeinate(pid: number): void {
  if (!isMac) return

  try {
    const caffeinate = spawn('caffeinate', ['-w', String(pid)], {
      detached: true,
      stdio: 'ignore',
    })
    caffeinate.unref()
    logger.debug(`Caffeinate started for PID ${pid}`)
  } catch (error) {
    // caffeinate 失败不影响任务执行
    logger.warn(`Failed to start caffeinate: ${error}`)
  }
}

export interface SpawnTaskOptions {
  taskId: string
  resume?: boolean  // 是否为恢复模式
}

/**
 * 获取脚本路径和执行命令
 * 开发模式下使用 .ts 文件 + tsx，生产模式下使用 .js 文件 + node
 *
 * 注意：tsup 打包后代码可能被放入 dist/ 的 chunk 文件中，
 * 但 runQueueProcess.js 和 runTaskProcess.js 始终在 dist/task/ 目录
 */
function getScriptConfig(scriptName: string): { execPath: string; scriptPath: string } {
  // 可能的脚本位置（按优先级排序）
  const possiblePaths = [
    // 1. 当前目录（开发模式或未打包时）
    join(currentDir, `${scriptName}.js`),
    // 2. task 子目录（tsup 打包后，chunk 在 dist/ 但脚本在 dist/task/）
    join(currentDir, 'task', `${scriptName}.js`),
    // 3. 开发模式 .ts 文件
    join(currentDir, `${scriptName}.ts`),
  ]

  // 检查 .js 文件
  for (const jsPath of possiblePaths.filter(p => p.endsWith('.js'))) {
    if (existsSync(jsPath)) {
      logger.debug(`Found script at: ${jsPath}`)
      return { execPath: process.execPath, scriptPath: jsPath }
    }
  }

  // 开发模式：使用 tsx 执行 .ts 文件
  const tsxPath = join(process.cwd(), 'node_modules', '.bin', 'tsx')
  const tsPath = join(currentDir, `${scriptName}.ts`)
  if (existsSync(tsPath) && existsSync(tsxPath)) {
    logger.debug(`Found TS script at: ${tsPath}, using tsx`)
    return { execPath: tsxPath, scriptPath: tsPath }
  }

  // 回退：假设在当前目录
  const fallbackPath = join(currentDir, `${scriptName}.js`)
  logger.warn(`Script not found, falling back to: ${fallbackPath}`)
  return { execPath: process.execPath, scriptPath: fallbackPath }
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

  // Find the runTaskProcess script path
  const { execPath, scriptPath } = getScriptConfig('runTaskProcess')

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
  logger.debug(`Exec: ${execPath}`)
  logger.debug(`Script: ${scriptPath}`)
  logger.debug(`Log: ${logPath}`)
  logger.debug(`Resume mode: ${resume}`)

  // Spawn detached process
  const child = spawn(
    execPath,
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

  // 启动 caffeinate 防止 Mac 休眠
  spawnCaffeinate(pid)

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
 * 如果锁文件存在但进程已死，自动清理锁文件
 */
function isRunnerRunning(): boolean {
  if (!existsSync(RUNNER_LOCK_FILE)) {
    return false
  }
  try {
    const pid = parseInt(readFileSync(RUNNER_LOCK_FILE, 'utf-8').trim(), 10)
    if (isNaN(pid)) {
      releaseRunnerLock()
      return false
    }
    const running = isProcessRunning(pid)
    if (!running) {
      // 进程已死，清理残留锁文件
      logger.debug(`Runner process ${pid} dead, cleaning up stale lock file`)
      releaseRunnerLock()
    }
    return running
  } catch {
    releaseRunnerLock()
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

  const { execPath, scriptPath } = getScriptConfig('runQueueProcess')

  logger.debug(`Spawning queue runner: ${execPath} ${scriptPath}`)

  // 创建日志文件用于调试
  mkdirSync(DATA_DIR, { recursive: true })
  const out = openSync(RUNNER_LOG_FILE, 'a')
  const err = openSync(RUNNER_LOG_FILE, 'a')

  const child = spawn(
    execPath,
    [scriptPath],
    {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: process.cwd(),
    }
  )

  // Close file descriptors in parent
  closeSync(out)
  closeSync(err)

  child.unref()

  // 写入锁文件
  if (child.pid) {
    createRunnerLock(child.pid)
    // 启动 caffeinate 防止 Mac 休眠
    spawnCaffeinate(child.pid)
  }

  logger.debug(`Queue runner spawned: PID ${child.pid}`)
}
