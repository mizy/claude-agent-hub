import chalk from 'chalk'
import { execSync } from 'child_process'
import { existsSync, accessSync, constants } from 'fs'
import { getAllTasks } from '../store/TaskStore.js'
import { isServiceRunning, type PidLockInfo } from './pidLock.js'
import { loadConfig } from '../config/loadConfig.js'
import { DATA_DIR, TASKS_DIR } from '../store/paths.js'
import { formatDuration } from '../shared/formatTime.js'
import type { Task } from '../types/task.js'
import {
  isRunningStatus,
  isPendingStatus,
  isTerminalStatus,
} from '../types/taskStatus.js'

export async function getDaemonStatus(): Promise<void> {
  const { running, lock } = isServiceRunning('daemon')

  // Header
  const statusIcon = running ? chalk.green('●') : chalk.red('●')
  const statusText = running ? chalk.green('Running') : chalk.red('Stopped')
  console.log()
  console.log(`${statusIcon} CAH System Status: ${statusText}`)
  console.log(chalk.dim('─'.repeat(50)))

  // Daemon section
  printDaemonSection(running, lock)

  // Task statistics
  const tasks = getAllTasks()
  printTaskSection(tasks)

  // Queue section
  printQueueSection(tasks)

  // Notifications
  await printNotifySection()

  // Storage
  printStorageSection(tasks)

  // Health
  printHealthSection(running)

  // Recent activity
  printRecentActivity(tasks)

  console.log()
}

// ============ Section Printers ============

function printDaemonSection(running: boolean, lock?: PidLockInfo): void {
  console.log()
  console.log(chalk.bold('  Daemon'))

  if (!running) {
    console.log(chalk.gray('    Status:      ') + chalk.red('Stopped'))
    if (lock) {
      console.log(chalk.gray(`    (stale PID ${lock.pid} cleaned up)`))
    }
    return
  }

  if (!lock) return

  const uptime = formatDuration(Date.now() - new Date(lock.startedAt).getTime())
  const memory = getProcessMemoryMB(lock.pid)

  console.log(chalk.gray('    Status:      ') + chalk.green(`Running (PID ${lock.pid})`))
  console.log(chalk.gray('    Uptime:      ') + uptime)
  if (memory !== null) {
    console.log(chalk.gray('    Memory:      ') + `${memory} MB`)
  }
}

function printTaskSection(tasks: Task[]): void {
  console.log()
  console.log(chalk.bold('  Tasks'))

  if (tasks.length === 0) {
    console.log(chalk.gray('    No tasks'))
    return
  }

  const running = tasks.filter(t => isRunningStatus(t.status)).length
  const pending = tasks.filter(t => isPendingStatus(t.status)).length
  const completed = tasks.filter(t => t.status === 'completed').length
  const failed = tasks.filter(t => t.status === 'failed').length
  const total = tasks.length

  // Today's completed
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayCompleted = tasks.filter(
    t => t.status === 'completed' && t.updatedAt && new Date(t.updatedAt) >= todayStart
  ).length

  // Success rate (only terminal tasks)
  const terminal = tasks.filter(t => isTerminalStatus(t.status))
  const successRate =
    terminal.length > 0 ? Math.round((completed / terminal.length) * 100) : 0

  console.log(chalk.gray('    Total:       ') + String(total))
  console.log(
    chalk.gray('    Running:     ') +
      (running > 0 ? chalk.green(running) : '0') +
      chalk.gray('    Pending: ') +
      (pending > 0 ? chalk.yellow(pending) : '0')
  )
  console.log(
    chalk.gray('    Completed:   ') +
      String(completed) +
      chalk.gray('    Failed:  ') +
      (failed > 0 ? chalk.red(failed) : '0')
  )
  console.log(
    chalk.gray('    Today:       ') +
      String(todayCompleted) +
      chalk.gray('    Success: ') +
      `${successRate}%`
  )
}

function printQueueSection(tasks: Task[]): void {
  const waiting = tasks.filter(t => isPendingStatus(t.status)).length
  const active = tasks.filter(t => isRunningStatus(t.status)).length

  console.log()
  console.log(chalk.bold('  Queue'))
  console.log(chalk.gray('    Waiting:     ') + String(waiting))
  console.log(chalk.gray('    Active:      ') + String(active))
}

async function printNotifySection(): Promise<void> {
  console.log()
  console.log(chalk.bold('  Notifications'))

  try {
    const config = await loadConfig()
    const lark = config.notify?.lark
    const telegram = config.notify?.telegram

    const larkStatus = lark?.appId
      ? chalk.green('Configured')
      : chalk.dim('Not configured')
    const telegramStatus = telegram?.botToken
      ? chalk.green('Configured')
      : chalk.dim('Not configured')

    console.log(chalk.gray('    Lark:        ') + larkStatus)
    console.log(chalk.gray('    Telegram:    ') + telegramStatus)
  } catch {
    console.log(chalk.gray('    Lark:        ') + chalk.dim('Unknown'))
    console.log(chalk.gray('    Telegram:    ') + chalk.dim('Unknown'))
  }
}

function printStorageSection(tasks: Task[]): void {
  console.log()
  console.log(chalk.bold('  Storage'))

  // Shorten path for display
  const displayPath = DATA_DIR.replace(process.env.HOME ?? '', '~')
  console.log(chalk.gray('    Data Dir:    ') + displayPath)

  const diskUsage = getDiskUsage(TASKS_DIR)
  const sizeStr = diskUsage ? `, ${diskUsage}` : ''
  console.log(chalk.gray('    Tasks:       ') + `${tasks.length} tasks${sizeStr}`)
}

function printHealthSection(daemonRunning: boolean): void {
  console.log()
  console.log(chalk.bold('  Health'))

  // Caffeinate check
  const caffeinateRunning = isProcessNameRunning('caffeinate')
  const caffeinateStatus = caffeinateRunning
    ? chalk.green('Running')
    : chalk.dim('Not running')
  console.log(chalk.gray('    Caffeinate:  ') + caffeinateStatus)

  // Data dir writable check
  let writable = false
  try {
    accessSync(DATA_DIR, constants.W_OK)
    writable = true
  } catch {
    // not writable
  }
  console.log(
    chalk.gray('    Data Dir:    ') +
      (writable ? chalk.green('Writable') : chalk.red('Not writable'))
  )

  // Daemon check (duplicate but under health context)
  if (!daemonRunning) {
    console.log(chalk.gray('    Daemon:      ') + chalk.yellow('Not running'))
  }
}

function printRecentActivity(tasks: Task[]): void {
  // Get recent completed/failed tasks, sorted by updatedAt desc
  const recentTerminal = tasks
    .filter(t => isTerminalStatus(t.status) && t.updatedAt)
    .sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime())
    .slice(0, 5)

  if (recentTerminal.length === 0) return

  console.log()
  console.log(chalk.bold('  Recent Activity'))

  for (const task of recentTerminal) {
    const icon = task.status === 'completed' ? chalk.green('✓') : chalk.red('✗')
    const title = truncate(task.title, 30)
    const ago = formatTimeAgo(new Date(task.updatedAt!))
    console.log(`    ${icon} ${title.padEnd(32)} ${chalk.dim(ago)}`)
  }
}

// ============ Helpers ============


function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}

function getProcessMemoryMB(pid: number): string | null {
  try {
    // ps -o rss= returns KB
    const output = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf-8' }).trim()
    const kb = parseInt(output, 10)
    if (isNaN(kb)) return null
    return String(Math.round(kb / 1024))
  } catch {
    return null
  }
}

function getDiskUsage(dir: string): string | null {
  if (!existsSync(dir)) return null
  try {
    const output = execSync(`du -sh "${dir}" 2>/dev/null`, { encoding: 'utf-8' }).trim()
    // "128M	/path/to/dir" → "128M"
    return output.split('\t')[0] ?? null
  } catch {
    return null
  }
}

function isProcessNameRunning(name: string): boolean {
  try {
    execSync(`pgrep -x ${name}`, { encoding: 'utf-8' })
    return true
  } catch {
    return false
  }
}
