import { existsSync, statSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { execSync, spawn } from 'child_process'
import { getPidLock, isProcessRunning } from '../../scheduler/pidLock.js'
import { isServiceRunning } from '../../scheduler/pidLock.js'
import type { HealthCheck, Diagnosis } from '../types.js'

/** Resolve bin/cah.js path from process.argv[1], not cwd */
function resolveBinPath(): string {
  const script = process.argv[1] || ''
  if (script.endsWith('bin/cah.js') || script.endsWith('bin/cah')) return script
  if (script.includes('/dist/')) return script.split('/dist/')[0] + '/bin/cah.js'
  return resolve(dirname(script), '..', 'bin', 'cah.js')
}

function getProcessStartTime(pid: number): Date | null {
  try {
    const output = execSync(`ps -o lstart= -p ${pid}`, { encoding: 'utf-8', timeout: 3000 }).trim()
    if (!output) return null
    const date = new Date(output)
    return isNaN(date.getTime()) ? null : date
  } catch {
    return null
  }
}

/** Check if current process IS the daemon (to avoid self-kill) */
function isRunningAsDaemon(): boolean {
  const daemonLock = getPidLock('daemon')
  return !!daemonLock && daemonLock.pid === process.pid
}

/** Restart daemon by spawning `cah start -D` after stopping the old one */
async function restartDaemonFix(): Promise<string> {
  // Never stop ourselves — daemon selfcheck should only notify, not self-kill
  if (isRunningAsDaemon()) {
    return 'Stale code detected but running inside daemon — skipped auto-restart (use `cah restart` manually)'
  }

  const { stopDaemon } = await import('../../scheduler/stopDaemon.js')

  const { running } = isServiceRunning('daemon')
  if (running) {
    await stopDaemon({})
    // Wait for process to fully stop
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

  // Wait and verify
  await new Promise(r => setTimeout(r, 2000))
  const { running: started } = isServiceRunning('daemon')
  return started
    ? 'Restarted daemon to load latest build'
    : 'Sent restart command, but daemon not yet confirmed running'
}

export const versionConsistencyCheck: HealthCheck = {
  name: 'version-consistency',
  description: 'Check that built code matches source and daemon runs latest version',
  async run() {
    const details: string[] = []
    let score = 100
    let diagnosis: Diagnosis | undefined

    // Find built entry point
    const distPath = join(process.cwd(), 'dist', 'cli', 'index.js')
    if (!existsSync(distPath)) {
      details.push('No dist/cli/index.js found (not built yet?)')
      return { name: this.name, status: 'warning', score: 80, details, fixable: false }
    }

    const buildTime = statSync(distPath).mtime

    // Check daemon
    const daemonLock = getPidLock('daemon')
    if (!daemonLock) {
      details.push('Daemon not running, no version check needed')
      return { name: this.name, status: 'pass', score: 100, details, fixable: false }
    }

    if (!isProcessRunning(daemonLock.pid)) {
      details.push('Daemon PID not alive, skipping version check')
      return { name: this.name, status: 'pass', score: 100, details, fixable: false }
    }

    // Compare daemon start time vs build time
    const startTime = getProcessStartTime(daemonLock.pid)
    const effectiveStartTime = startTime || new Date(daemonLock.startedAt)

    if (effectiveStartTime < buildTime) {
      score -= 30
      details.push(
        `Daemon started at ${effectiveStartTime.toISOString()} but code built at ${buildTime.toISOString()} - running stale code`
      )
      diagnosis = {
        category: 'stale_code',
        rootCause: 'Daemon process was started before the latest build, running outdated code',
        suggestedFix: 'Restart daemon to load latest build (cah restart)',
      }
    } else {
      details.push(`Daemon started after latest build${startTime ? '' : ' (from lock file)'}`)
    }

    score = Math.max(0, score)
    const isStale = score < 100

    // Inside daemon: downgrade to warning (can't safely self-restart)
    const inDaemon = isRunningAsDaemon()
    const status = inDaemon && isStale
      ? 'warning'
      : score >= 80 ? (score === 100 ? 'pass' : 'warning') : 'fail'

    return {
      name: this.name,
      status,
      score,
      details: inDaemon && isStale
        ? [...details, 'Running inside daemon — auto-restart disabled, use `cah restart`']
        : details,
      fixable: isStale && !inDaemon,
      fix: isStale && !inDaemon ? restartDaemonFix : undefined,
      diagnosis,
    }
  },
}
