/**
 * Dashboard 命令
 *
 * 启动 HTTP server 来可视化 Workflow 执行状态
 * 支持 start/stop/status 子命令和 -D 后台运行模式
 */

import { Command } from 'commander'
import { startServer } from '../../server/index.js'
import {
  acquirePidLock,
  releasePidLock,
  isServiceRunning,
  getPidLock,
} from '../../scheduler/pidLock.js'

export function registerDashboardCommand(program: Command) {
  const dashboard = program.command('dashboard').description('Workflow 可视化面板')

  // cah dashboard start (default action)
  dashboard
    .command('start', { isDefault: true })
    .description('启动面板')
    .option('-p, --port <port>', '服务器端口', '7788')
    .option('-H, --host <host>', '监听地址', 'localhost')
    .option('--open', '启动后自动打开浏览器')
    .option('-D, --detach', '后台运行（fork 子进程）')
    .action(async options => {
      if (options.detach) {
        await spawnDashboardDetached(options)
        return
      }

      // 前台模式：检查是否已运行
      const { running, lock } = isServiceRunning('dashboard')
      if (running && lock) {
        const chalk = (await import('chalk')).default
        console.log(chalk.yellow(`Dashboard 已在运行 (PID: ${lock.pid})`))
        console.log(chalk.gray('使用 cah dashboard stop 停止后重启'))
        return
      }

      // 获取 PID 锁
      const result = acquirePidLock('dashboard')
      if (!result.success) {
        const chalk = (await import('chalk')).default
        console.log(chalk.red('无法获取 PID 锁'))
        return
      }

      // 优雅关闭
      const cleanup = () => {
        releasePidLock('dashboard')
        process.exit(0)
      }
      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)

      startServer({
        port: parseInt(options.port, 10),
        host: options.host,
        open: options.open,
      })
    })

  // cah dashboard stop
  dashboard
    .command('stop')
    .description('停止面板')
    .action(async () => {
      await stopDashboard()
    })

  // cah dashboard status
  dashboard
    .command('status')
    .description('查看面板状态')
    .action(async () => {
      await dashboardStatus()
    })
}

/** fork 子进程后台运行 dashboard */
async function spawnDashboardDetached(options: { port: string; host: string }) {
  const { spawn } = await import('child_process')
  const { mkdirSync, openSync } = await import('fs')
  const { join } = await import('path')
  const { DATA_DIR } = await import('../../store/paths.js')
  const chalk = (await import('chalk')).default

  // 检查是否已运行
  const { running, lock } = isServiceRunning('dashboard')
  if (running && lock) {
    console.log(chalk.yellow(`Dashboard 已在运行 (PID: ${lock.pid})`))
    console.log(chalk.gray('使用 cah dashboard stop 停止后重启'))
    return
  }

  mkdirSync(DATA_DIR, { recursive: true })

  const logFile = join(DATA_DIR, 'dashboard.log')
  const logFd = openSync(logFile, 'a')
  const errFd = openSync(logFile, 'a')

  // 重新运行当前脚本，去掉 -D/--detach
  const args = process.argv.slice(2).filter(a => a !== '--detach' && a !== '-D')
  const script = process.argv[1]
  const child = spawn(process.execPath, [...process.execArgv, script!, ...args], {
    detached: true,
    stdio: ['ignore', logFd, errFd],
  })
  child.unref()

  const displayHost = options.host === '0.0.0.0' ? 'localhost' : options.host
  const url = `http://${displayHost}:${options.port}`
  console.log(chalk.green(`✓ Dashboard 已在后台启动 (PID: ${child.pid})`))
  console.log(chalk.gray(`  地址: ${url}`))
  console.log(chalk.gray(`  日志: ${logFile}`))
  console.log(chalk.gray(`  停止: cah dashboard stop`))
}

/** 停止 dashboard */
async function stopDashboard(): Promise<void> {
  const chalk = (await import('chalk')).default

  const lock = getPidLock('dashboard')
  if (!lock) {
    console.log(chalk.yellow('Dashboard 未运行'))
    return
  }

  try {
    process.kill(lock.pid, 'SIGTERM')
    releasePidLock('dashboard')
    console.log(chalk.green(`✓ 已停止 Dashboard (PID: ${lock.pid})`))
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    ) {
      console.log(chalk.yellow('进程已不存在，清理残留文件'))
      releasePidLock('dashboard')
    } else {
      throw error
    }
  }
}

/** 查看 dashboard 状态 */
async function dashboardStatus(): Promise<void> {
  const chalk = (await import('chalk')).default

  const { running, lock } = isServiceRunning('dashboard')
  if (!running || !lock) {
    console.log(chalk.yellow('Dashboard 未运行'))
    return
  }

  console.log(chalk.green('Dashboard 运行中'))
  console.log(chalk.gray(`  PID: ${lock.pid}`))
  console.log(chalk.gray(`  启动时间: ${lock.startedAt}`))
  console.log(chalk.gray(`  工作目录: ${lock.cwd}`))
}
