import cron from 'node-cron'
import chalk from 'chalk'
import { getStore } from '../store/index.js'
import { loadConfig } from '../config/loadConfig.js'
import { runAgent } from '../agent/runAgent.js'

interface DaemonOptions {
  agent?: string
  foreground?: boolean
}

let scheduledJobs: cron.ScheduledTask[] = []

export async function startDaemon(options: DaemonOptions): Promise<void> {
  const config = await loadConfig()
  const store = getStore()

  const agents = options.agent
    ? [store.getAgent(options.agent)].filter(Boolean)
    : store.getAllAgents()

  if (agents.length === 0) {
    console.log(chalk.yellow('没有可用的 Agent'))
    return
  }

  console.log(chalk.green('启动 Agent 守护进程...'))

  for (const agent of agents) {
    if (!agent) continue

    const agentConfig = config.agents?.find(a => a.name === agent.name)
    const pollInterval = agentConfig?.schedule?.poll_interval || '5m'

    // 转换间隔为 cron 表达式
    const cronExpr = intervalToCron(pollInterval)

    console.log(chalk.gray(`  [${agent.name}] 轮询间隔: ${pollInterval}`))

    const job = cron.schedule(cronExpr, async () => {
      console.log(chalk.blue(`[${new Date().toISOString()}] [${agent.name}] 开始轮询...`))
      try {
        await runAgent(agent.name)
      } catch (error) {
        console.error(chalk.red(`[${agent.name}] 执行出错:`), error)
      }
    })

    scheduledJobs.push(job)
  }

  // 保存 PID
  store.setDaemonPid(process.pid)

  console.log(chalk.green(`✓ 守护进程已启动 (PID: ${process.pid})`))

  if (options.foreground) {
    // 前台运行，等待信号
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n收到中断信号，停止守护进程...'))
      stopAllJobs()
      process.exit(0)
    })
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
