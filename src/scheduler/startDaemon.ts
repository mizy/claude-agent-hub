/**
 * 守护进程启动
 *
 * 默认前台运行（阻塞），接收 Ctrl+C 优雅退出
 * --detach 模式 fork 子进程后台运行
 */

import cron from 'node-cron'
import chalk from 'chalk'
import { spawn, type ChildProcess } from 'child_process'
import { getStore } from '../store/index.js'
import { loadConfig } from '../config/loadConfig.js'
import { executeTask } from '../task/executeTask.js'
import { pollPendingTask } from '../task/queryTask.js'
import { withProcessTracking } from '../task/processTracking.js'
import { stopLarkServer } from '../notify/larkServer.js'
import { startLarkWsClient, stopLarkWsClient } from '../notify/larkWsClient.js'
import { startTelegramClient, stopTelegramClient } from '../notify/telegramClient.js'
import { acquirePidLock, releasePidLock, isDaemonRunning } from './pidLock.js'

interface DaemonOptions {
  detach?: boolean
}

let scheduledJobs: cron.ScheduledTask[] = []
let caffeinateProcess: ChildProcess | null = null

/** 启动 caffeinate 防止 macOS 睡眠 (-i idle 仅阻止系统空闲睡眠，允许显示器息屏) */
function startSleepPrevention(): void {
  if (process.platform !== 'darwin') return

  try {
    caffeinateProcess = spawn('caffeinate', ['-i', '-w', String(process.pid)], {
      detached: true,
      stdio: 'ignore',
    })
    caffeinateProcess.unref()
    console.log(chalk.green('  ✓ 防睡眠已启用 (caffeinate -i)'))
    console.log(chalk.gray('  ℹ 允许显示器自动息屏，后台进程继续运行'))
    console.log(chalk.gray('  ℹ 合盖会自动睡眠（正常行为）'))
  } catch {
    console.warn(chalk.yellow('  ⚠ 防睡眠启动失败'))
  }
}

/** 停止 caffeinate */
function stopSleepPrevention(): void {
  if (caffeinateProcess) {
    caffeinateProcess.kill()
    caffeinateProcess = null
  }
}

/**
 * 启动守护进程
 * 默认前台阻塞运行，--detach 后台运行
 */
export async function startDaemon(options: DaemonOptions): Promise<void> {
  if (options.detach) {
    return await spawnDetached()
  }

  await runDaemon()
}

/** fork 子进程后台运行 */
async function spawnDetached(): Promise<void> {
  // 先检查是否已有 daemon 在运行
  const { running, lock } = isDaemonRunning()
  if (running && lock) {
    console.error(chalk.red('✗ 守护进程已在运行'))
    console.error(chalk.yellow(`  PID: ${lock.pid}`))
    console.error(chalk.yellow(`  启动时间: ${lock.startedAt}`))
    console.error(chalk.gray(`\n  使用 'cah daemon stop' 停止现有进程`))
    process.exit(1)
  }

  const { DATA_DIR } = await import('../store/paths.js')
  const { mkdirSync, openSync } = await import('fs')
  const { join } = await import('path')

  // 确保数据目录存在
  mkdirSync(DATA_DIR, { recursive: true })

  // 创建日志文件
  const logFile = join(DATA_DIR, 'daemon.log')
  const errFile = join(DATA_DIR, 'daemon.err.log')
  const logFd = openSync(logFile, 'a')
  const errFd = openSync(errFile, 'a')

  const args = process.argv.slice(2).filter(a => a !== '--detach' && a !== '-D')
  const child = spawn(process.execPath, [...process.execArgv, ...getEntryArgs(), ...args], {
    detached: true,
    stdio: ['ignore', logFd, errFd],
  })
  child.unref()

  console.log(chalk.green(`✓ 守护进程已在后台启动 (PID: ${child.pid})`))
  console.log(chalk.gray(`  日志: ${logFile}`))
  console.log(chalk.gray(`  错误: ${errFile}`))
  console.log(chalk.gray(`  使用 cah daemon stop 停止`))
  console.log(chalk.gray(`  使用 tail -f ${logFile} 查看日志`))
}

/** 获取当前入口脚本参数 */
function getEntryArgs(): string[] {
  // process.argv: [node, script, ...args]
  const script = process.argv[1]
  return script ? [script] : []
}

/** 实际运行守护进程（前台阻塞） */
async function runDaemon(): Promise<void> {
  // 尝试获取 PID 锁
  const lockResult = acquirePidLock()
  if (!lockResult.success) {
    const lock = lockResult.existingLock
    console.error(chalk.red('✗ 守护进程已在运行'))
    console.error(chalk.yellow(`  PID: ${lock.pid}`))
    console.error(chalk.yellow(`  启动时间: ${lock.startedAt}`))
    console.error(chalk.yellow(`  工作目录: ${lock.cwd}`))
    console.error(chalk.gray(`\n  使用 'cah daemon stop' 停止现有进程`))
    console.error(chalk.gray(`  或使用 'kill ${lock.pid}' 强制停止`))
    process.exit(1)
  }

  const config = await loadConfig()
  const store = getStore()

  const agentConfig = config.agents?.[0]
  const pollInterval = agentConfig?.schedule?.poll_interval || '5m'
  const cronExpr = intervalToCron(pollInterval)

  console.log(chalk.green('启动守护进程...'))
  console.log(chalk.gray(`  轮询间隔: ${pollInterval}`))

  // 任务轮询
  const job = cron.schedule(cronExpr, async () => {
    try {
      const task = await pollPendingTask()
      if (!task) return
      console.log(chalk.blue(`[${new Date().toLocaleTimeString()}] 执行任务: ${task.title}`))

      await withProcessTracking(task.id, () =>
        executeTask(task, { concurrency: 1, useConsole: false })
      )
    } catch (error) {
      console.error(chalk.red(`执行出错:`), error)
    }
  })
  scheduledJobs.push(job)

  // 根据配置自动启动通知平台
  const larkConfig = config.notify?.lark
  const telegramConfig = config.notify?.telegram

  if (larkConfig?.appId && larkConfig?.appSecret) {
    try {
      await startLarkWsClient()
      console.log(chalk.green('  ✓ 飞书已启动 (WebSocket 长连接)'))
    } catch (error) {
      console.error(chalk.red('  ✗ 飞书启动失败:'), error)
    }
  }

  if (telegramConfig?.botToken) {
    try {
      await startTelegramClient()
      console.log(chalk.green('  ✓ Telegram 已启动 (长轮询)'))
    } catch (error) {
      console.error(chalk.red('  ✗ Telegram 启动失败:'), error)
    }
  }

  store.setDaemonPid(process.pid)
  startSleepPrevention()
  console.log(chalk.green(`✓ 守护进程运行中 (PID: ${process.pid})`))
  console.log(chalk.gray('  Ctrl+C 停止'))

  // 前台阻塞，等待信号优雅退出
  const cleanup = async () => {
    console.log(chalk.yellow('\n停止守护进程...'))
    stopSleepPrevention()
    stopAllJobs()
    await stopLarkServer()
    await stopLarkWsClient()
    stopTelegramClient()
    releasePidLock()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // 进程异常退出时也要释放锁
  process.on('uncaughtException', error => {
    console.error(chalk.red('Uncaught exception:'), error)
    releasePidLock()
    process.exit(1)
  })

  process.on('unhandledRejection', reason => {
    console.error(chalk.red('Unhandled rejection:'), reason)
    releasePidLock()
    process.exit(1)
  })
}

function intervalToCron(interval: string): string {
  const match = interval.match(/^(\d+)(m|h|d)$/)
  if (!match) return '*/5 * * * *'

  const num = match[1]
  const unit = match[2]
  if (!num) return '*/5 * * * *'

  const n = parseInt(num, 10)

  switch (unit) {
    case 'm':
      return `*/${n} * * * *`
    case 'h':
      return `0 */${n} * * *`
    case 'd':
      return `0 0 */${n} * *`
    default:
      return '*/5 * * * *'
  }
}

function stopAllJobs() {
  for (const job of scheduledJobs) {
    job.stop()
  }
  scheduledJobs = []
}
