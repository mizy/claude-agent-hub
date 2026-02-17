/**
 * 守护进程重启
 *
 * 原子化执行 stop + start，确保无缝切换
 * 支持自动重启 dashboard（如果重启前在运行）
 */

import { resolve, dirname } from 'path'
import chalk from 'chalk'
import { stopDaemon } from './stopDaemon.js'
import { isServiceRunning } from './pidLock.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('restart-daemon')

export interface RestartOptions {
  detach?: boolean
}

/** Resolve bin/cah.js path from process.argv[1], matching startDaemon logic */
function resolveBinPath(): string {
  const script = process.argv[1] || ''

  // Already pointing to bin/cah.js
  if (script.endsWith('bin/cah.js') || script.endsWith('bin/cah')) {
    return script
  }

  // Running from dist/ — derive project root
  if (script.includes('/dist/')) {
    return script.split('/dist/')[0] + '/bin/cah.js'
  }

  // Fallback: try relative to script directory
  return resolve(dirname(script), '..', 'bin', 'cah.js')
}

/**
 * Restart dashboard in detached mode
 * Failure does not block daemon restart
 */
async function restartDashboard(binPath: string): Promise<void> {
  try {
    const { spawn } = await import('child_process')
    const { mkdirSync, openSync } = await import('fs')
    const { join } = await import('path')
    const { DATA_DIR } = await import('../store/paths.js')

    mkdirSync(DATA_DIR, { recursive: true })
    const logFile = join(DATA_DIR, 'dashboard.log')
    const logFd = openSync(logFile, 'a')
    const errFd = openSync(logFile, 'a')

    const child = spawn(process.execPath, [binPath, 'dashboard', 'start'], {
      detached: true,
      stdio: ['ignore', logFd, errFd],
    })
    child.unref()

    console.log(chalk.green(`✓ Dashboard 已自动重启 (PID: ${child.pid})`))
  } catch (error) {
    logger.warn(`Failed to restart dashboard: ${error}`)
    console.log(chalk.yellow('⚠ Dashboard 自动重启失败，请手动启动: cah dashboard start -D'))
  }
}

/**
 * 重启守护进程
 * 1. 优雅停止现有进程及子进程（如果有）
 * 2. 等待停止完成
 * 3. 通过 spawn 新进程启动（避免模块缓存问题）
 * 4. 如果 dashboard 之前在运行，自动重启
 */
export async function restartDaemon(_options: RestartOptions): Promise<void> {
  const { running } = isServiceRunning('daemon')
  let dashboardWasRunning = false

  if (running) {
    console.log(chalk.yellow('正在停止现有守护进程及子进程...'))
    const stopResult = await stopDaemon({})
    dashboardWasRunning = stopResult.dashboardWasRunning
    // 等待进程完全停止
    await new Promise(resolve => setTimeout(resolve, 1500))
  } else {
    // Daemon not running, but check if dashboard is running independently
    dashboardWasRunning = isServiceRunning('dashboard').running
    console.log(chalk.gray('守护进程未运行，直接启动'))
  }

  console.log(chalk.green('启动新守护进程...'))

  // 通过 spawn 新进程启动，避免当前进程的模块缓存影响
  // 从 process.argv[1] 推断 bin/cah.js 路径，与 startDaemon 一致
  const { spawn } = await import('child_process')
  const binPath = resolveBinPath()
  const child = spawn(process.execPath, [binPath, 'start', '-D'], {
    detached: true,
    stdio: 'ignore', // 完全分离子进程，避免阻塞父进程
    env: process.env,
  })

  if (!child.pid) {
    console.log(chalk.red('✗ 守护进程启动失败：无法获取进程 PID'))
    return
  }

  child.unref()

  // 等待并验证进程启动
  await new Promise(resolve => setTimeout(resolve, 2000))
  const { running: started } = isServiceRunning('daemon')
  if (started) {
    console.log(chalk.green('✓ 守护进程已成功重启'))
  } else {
    console.log(chalk.yellow('⚠ 启动命令已发送，但守护进程尚未就绪'))
    console.log(chalk.gray('  使用 cah status 确认状态'))
  }

  // Restart dashboard if it was running before
  if (dashboardWasRunning) {
    console.log(chalk.gray('正在重启 Dashboard...'))
    await restartDashboard(binPath)
  }
}
