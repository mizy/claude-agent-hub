/**
 * Auto-repair for detected signals
 *
 * Provides fix actions for infrastructure signals (stale_daemon, corrupt_task_data).
 * Extracted from the former selfcheck module's fix logic.
 */

import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { TASKS_DIR, FILE_NAMES } from '../store/paths.js'
import { getPidLock, isServiceRunning } from '../scheduler/pidLock.js'
import { createLogger } from '../shared/logger.js'
import type { SignalEvent } from './signalDetector.js'

const logger = createLogger('selfevolve:repair')

/** Resolve bin/cah.js path from process.argv[1] */
function resolveBinPath(): string {
  const script = process.argv[1] || ''
  if (script.endsWith('bin/cah.js') || script.endsWith('bin/cah')) return script
  if (script.includes('/dist/')) return script.split('/dist/')[0] + '/bin/cah.js'
  return resolve(dirname(script), '..', 'bin', 'cah.js')
}

/** Check if current process IS the daemon */
function isRunningAsDaemon(): boolean {
  const daemonLock = getPidLock('daemon')
  return !!daemonLock && daemonLock.pid === process.pid
}

async function repairStaleDaemon(): Promise<string | null> {
  if (isRunningAsDaemon()) {
    return 'Stale code detected but running inside daemon — use `cah restart` manually'
  }

  const { stopDaemon } = await import('../scheduler/stopDaemon.js')

  const { running } = isServiceRunning('daemon')
  if (running) {
    await stopDaemon({ keepDashboard: true })
    await new Promise(r => setTimeout(r, 1500))
  }

  const binPath = resolveBinPath()
  const child = spawn(process.execPath, [binPath, 'start', '-D'], {
    detached: true,
    stdio: 'ignore',
    env: (() => {
      const env = { ...process.env }
      delete env.CLAUDECODE
      delete env.CLAUDE_CODE_ENTRYPOINT
      return env
    })(),
  })
  child.unref()

  await new Promise(r => setTimeout(r, 2000))
  const { running: started } = isServiceRunning('daemon')
  return started
    ? 'Restarted daemon to load latest build'
    : 'Sent restart command, but daemon not yet confirmed running'
}

function tryParseJson(filePath: string): boolean {
  try {
    JSON.parse(readFileSync(filePath, 'utf-8'))
    return true
  } catch {
    return false
  }
}

function repairCorruptTaskData(): string | null {
  if (!existsSync(TASKS_DIR)) return null

  let taskDirs: string[]
  try {
    taskDirs = readdirSync(TASKS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('task-'))
      .map(d => d.name)
  } catch {
    return null
  }

  const REQUIRED_FILES = [FILE_NAMES.TASK, FILE_NAMES.WORKFLOW, FILE_NAMES.INSTANCE] as const
  let fixed = 0

  for (const dir of taskDirs) {
    const taskDir = join(TASKS_DIR, dir)
    if (!existsSync(join(taskDir, FILE_NAMES.TASK))) continue

    for (const file of REQUIRED_FILES) {
      const filePath = join(taskDir, file)
      if (existsSync(filePath) && !tryParseJson(filePath)) {
        try {
          renameSync(filePath, filePath + '.bak')
          writeFileSync(filePath, '{}', 'utf-8')
          fixed++
        } catch {
          logger.debug(`Failed to repair: ${filePath}`)
        }
      }
    }
  }

  return fixed > 0
    ? `Backed up and reset ${fixed} corrupt JSON file(s)`
    : null
}

/**
 * Attempt auto-repair for a detected signal.
 * Returns a description of the fix applied, or null if no fix was needed/possible.
 */
export async function tryAutoRepair(signal: SignalEvent): Promise<string | null> {
  switch (signal.type) {
    case 'stale_daemon':
      return repairStaleDaemon()
    case 'corrupt_task_data':
      return repairCorruptTaskData()
    default:
      return null
  }
}
