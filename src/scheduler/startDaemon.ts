import cron from 'node-cron'
import chalk from 'chalk'
import { getStore } from '../store/index.js'
import { loadConfig } from '../config/loadConfig.js'
import { executeTask } from '../agent/executeAgent.js'
import { pollPendingTask } from '../task/pollTask.js'
import { startLarkServer, stopLarkServer } from '../notify/larkServer.js'
import { startLarkWsClient, stopLarkWsClient } from '../notify/larkWsClient.js'

interface DaemonOptions {
  foreground?: boolean
  lark?: boolean
  larkWs?: boolean
  larkPort?: number
}

let scheduledJobs: cron.ScheduledTask[] = []

export async function startDaemon(options: DaemonOptions): Promise<void> {
  const config = await loadConfig()
  const store = getStore()

  // 获取轮询间隔配置（从 agents 配置中获取第一个，或使用默认值）
  const agentConfig = config.agents?.[0]
  const pollInterval = agentConfig?.schedule?.poll_interval || '5m'

  console.log(chalk.green('启动守护进程...'))

  // 转换间隔为 cron 表达式
  const cronExpr = intervalToCron(pollInterval)

  console.log(chalk.gray(`  轮询间隔: ${pollInterval}`))

  const job = cron.schedule(cronExpr, async () => {
    console.log(chalk.blue(`[${new Date().toISOString()}] 开始轮询...`))
    try {
      const task = await pollPendingTask()
      if (!task) {
        console.log(chalk.gray('  没有待处理任务'))
        return
      }
      console.log(chalk.blue(`  执行任务: ${task.title}`))
      await executeTask(task, { concurrency: 1, saveToTaskFolder: true, useConsole: false })
    } catch (error) {
      console.error(chalk.red(`执行出错:`), error)
    }
  })

  scheduledJobs.push(job)

  // 启动飞书事件监听
  if (options.larkWs) {
    // WebSocket 长连接模式（推荐，无需公网 IP）
    try {
      await startLarkWsClient()
      console.log(chalk.green('  ✓ 飞书 WebSocket 客户端已启动 (长连接模式)'))
    } catch (error) {
      console.error(chalk.red('  ✗ 飞书 WebSocket 客户端启动失败:'), error)
    }
  } else if (options.lark || config.notify?.lark?.webhookUrl) {
    // HTTP 服务器模式（需要公网 IP）
    try {
      await startLarkServer(options.larkPort)
      console.log(chalk.green('  ✓ 飞书事件监听服务器已启动 (HTTP 模式)'))
    } catch (error) {
      console.error(chalk.red('  ✗ 飞书服务器启动失败:'), error)
    }
  }

  // 保存 PID
  store.setDaemonPid(process.pid)

  console.log(chalk.green(`✓ 守护进程已启动 (PID: ${process.pid})`))

  if (options.foreground) {
    // 前台运行，等待信号
    const cleanup = async () => {
      console.log(chalk.yellow('\n收到中断信号，停止守护进程...'))
      stopAllJobs()
      await stopLarkServer()
      await stopLarkWsClient()
      process.exit(0)
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
  }
}

function intervalToCron(interval: string): string {
  const match = interval.match(/^(\d+)(m|h|d)$/)
  if (!match) return '*/5 * * * *' // 默认每 5 分钟

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
