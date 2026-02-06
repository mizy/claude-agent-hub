/**
 * 守护进程启动
 *
 * 默认前台运行（阻塞），接收 Ctrl+C 优雅退出
 * --detach 模式 fork 子进程后台运行
 */

import cron from 'node-cron'
import chalk from 'chalk'
import { spawn } from 'child_process'
import { getStore } from '../store/index.js'
import { loadConfig } from '../config/loadConfig.js'
import { executeTask } from '../task/executeTask.js'
import { pollPendingTask } from '../task/queryTask.js'
import { stopLarkServer } from '../notify/larkServer.js'
import { startLarkWsClient, stopLarkWsClient } from '../notify/larkWsClient.js'
import { startTelegramClient, stopTelegramClient } from '../notify/telegramClient.js'

interface DaemonOptions {
  detach?: boolean
}

let scheduledJobs: cron.ScheduledTask[] = []

/**
 * 启动守护进程
 * 默认前台阻塞运行，--detach 后台运行
 */
export async function startDaemon(options: DaemonOptions): Promise<void> {
  if (options.detach) {
    return spawnDetached()
  }

  await runDaemon()
}

/** fork 子进程后台运行 */
function spawnDetached(): void {
  const args = process.argv.slice(2).filter(a => a !== '--detach' && a !== '-D')
  const child = spawn(process.execPath, [...process.execArgv, ...getEntryArgs(), ...args], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  console.log(chalk.green(`✓ 守护进程已在后台启动 (PID: ${child.pid})`))
  console.log(chalk.gray(`  使用 cah daemon stop 停止`))
}

/** 获取当前入口脚本参数 */
function getEntryArgs(): string[] {
  // process.argv: [node, script, ...args]
  const script = process.argv[1]
  return script ? [script] : []
}

/** 实际运行守护进程（前台阻塞） */
async function runDaemon(): Promise<void> {
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
      await executeTask(task, { concurrency: 1, saveToTaskFolder: true, useConsole: false })
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
  console.log(chalk.green(`✓ 守护进程运行中 (PID: ${process.pid})`))
  console.log(chalk.gray('  Ctrl+C 停止'))

  // 前台阻塞，等待信号优雅退出
  const cleanup = async () => {
    console.log(chalk.yellow('\n停止守护进程...'))
    stopAllJobs()
    await stopLarkServer()
    await stopLarkWsClient()
    stopTelegramClient()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
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
