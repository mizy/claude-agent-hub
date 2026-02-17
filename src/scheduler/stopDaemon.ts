import chalk from 'chalk'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { getStore } from '../store/index.js'
import { TASKS_DIR, RUNNER_LOCK_FILE } from '../store/paths.js'
import { getPidLock, releasePidLock, isProcessRunning, isServiceRunning } from './pidLock.js'
import { releaseRunnerLock } from '../task/spawnTask.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('stop-daemon')

interface StopOptions {
  agent?: string
}

export interface StopResult {
  dashboardWasRunning: boolean
}

/**
 * Kill a process gracefully: SIGTERM first, then SIGKILL after timeout
 */
function killProcess(pid: number, label: string): boolean {
  try {
    process.kill(pid, 'SIGTERM')
    logger.info(`Sent SIGTERM to ${label} (PID ${pid})`)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') {
      logger.debug(`${label} (PID ${pid}) already dead`)
      return false
    }
    logger.warn(`Failed to kill ${label} (PID ${pid}): ${code}`)
    return false
  }
}

/**
 * Kill runner process found in runner.lock
 */
function killRunner(): void {
  if (!existsSync(RUNNER_LOCK_FILE)) return

  try {
    const pid = parseInt(readFileSync(RUNNER_LOCK_FILE, 'utf-8').trim(), 10)
    if (isNaN(pid)) {
      releaseRunnerLock()
      return
    }
    if (isProcessRunning(pid)) {
      killProcess(pid, 'queue-runner')
    }
    releaseRunnerLock()
  } catch {
    releaseRunnerLock()
  }
}

/**
 * Kill all running task processes by scanning process.json files
 */
function killTaskProcesses(): number {
  if (!existsSync(TASKS_DIR)) return 0

  let killed = 0
  try {
    const entries = readdirSync(TASKS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const processFile = join(TASKS_DIR, entry.name, 'process.json')
      if (!existsSync(processFile)) continue

      try {
        const content = readFileSync(processFile, 'utf-8')
        const info = JSON.parse(content)
        const pid = info?.pid
        if (typeof pid !== 'number' || pid === process.pid) continue
        if (isProcessRunning(pid)) {
          killProcess(pid, `task-${entry.name}`)
          killed++
        }
      } catch {
        logger.debug(`Failed to read ${processFile}, skipping`)
      }
    }
  } catch {
    logger.debug('Failed to scan task processes')
  }
  return killed
}

/**
 * Kill dashboard process if running
 * Returns whether dashboard was running before stop
 */
function killDashboard(): boolean {
  const { running, lock } = isServiceRunning('dashboard')
  if (!running || !lock) return false

  killProcess(lock.pid, 'dashboard')
  releasePidLock('dashboard')
  return true
}

export async function stopDaemon(_options: StopOptions): Promise<StopResult> {
  const store = getStore()
  const result: StopResult = { dashboardWasRunning: false }

  // 1. Stop daemon main process
  const lock = getPidLock()
  const pid = lock?.pid || store.getDaemonPid()

  if (!pid) {
    console.log(chalk.yellow('守护进程未运行'))
  } else {
    try {
      process.kill(pid, 'SIGTERM')
      store.setDaemonPid(null)
      console.log(chalk.green(`✓ 已发送停止信号到守护进程 (PID ${pid})`))
      releasePidLock()
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
        console.log(chalk.yellow('守护进程已不存在，清理残留文件'))
        store.setDaemonPid(null)
        releasePidLock()
      } else {
        throw error
      }
    }
  }

  // 2. Kill queue runner
  killRunner()

  // 3. Kill running task processes
  const taskKilled = killTaskProcesses()
  if (taskKilled > 0) {
    console.log(chalk.green(`✓ 已停止 ${taskKilled} 个任务进程`))
  }

  // 4. Kill dashboard
  result.dashboardWasRunning = killDashboard()
  if (result.dashboardWasRunning) {
    console.log(chalk.green('✓ 已停止 Dashboard'))
  }

  return result
}
