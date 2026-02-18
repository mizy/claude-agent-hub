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
import {
  startLarkWsClient,
  stopLarkWsClient,
  startTelegramClient,
  stopTelegramClient,
  registerTaskEventListeners,
} from '../messaging/index.js'
import { destroyChatHandler, loadSessions, configureSession } from '../messaging/index.js'
import { acquirePidLock, releasePidLock, isServiceRunning } from './pidLock.js'
import { runSelfcheck, runFixes, generateRepairTask } from '../selfcheck/index.js'
import type { SelfcheckReport } from '../selfcheck/index.js'
import { runEvolutionCycle } from '../prompt-optimization/index.js'
import { BUILTIN_PERSONAS } from '../persona/builtinPersonas.js'
import { resumeSelfDriveIfEnabled, stopSelfDrive } from '../selfdrive/index.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('daemon')

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
  const { running, lock } = isServiceRunning('daemon')
  if (running && lock) {
    console.error(chalk.red('✗ 守护进程已在运行'))
    console.error(chalk.yellow(`  PID: ${lock.pid}`))
    console.error(chalk.yellow(`  启动时间: ${lock.startedAt}`))
    console.error(chalk.gray(`\n  使用 'cah daemon stop' 停止现有进程`))
    process.exit(1)
  }

  const { DATA_DIR } = await import('../store/paths.js')
  const { mkdirSync, openSync, existsSync, renameSync } = await import('fs')
  const { join } = await import('path')

  // 确保数据目录存在
  mkdirSync(DATA_DIR, { recursive: true })

  // Log rotation: rename existing logs to .old before creating new ones
  const logFile = join(DATA_DIR, 'daemon.log')
  const errFile = join(DATA_DIR, 'daemon.err.log')
  if (existsSync(logFile)) {
    renameSync(logFile, logFile + '.old')
  }
  if (existsSync(errFile)) {
    renameSync(errFile, errFile + '.old')
  }
  const logFd = openSync(logFile, 'w')
  const errFd = openSync(errFile, 'w')

  const args = process.argv.slice(2).filter(a => a !== '--detach' && a !== '-D')
  const child = spawn(process.execPath, [...process.execArgv, ...getEntryArgs(), ...args], {
    detached: true,
    stdio: ['ignore', logFd, errFd],
    cwd: process.cwd(), // 确保工作目录正确，能找到 dist 文件
    env: (() => {
      const env = { ...process.env }
      delete env.CLAUDECODE
      delete env.CLAUDE_CODE_ENTRYPOINT
      return env
    })(),
  })
  child.unref()

  console.log(chalk.green(`✓ 守护进程已在后台启动 (PID: ${child.pid})`))
  console.log(chalk.gray(`  日志: ${logFile}`))
  console.log(chalk.gray(`  错误: ${errFile}`))
  console.log(chalk.gray(`  使用 cah daemon stop 停止`))
  console.log(chalk.gray(`  使用 tail -F ${logFile} 查看日志`))
}

/** 获取当前入口脚本参数 */
function getEntryArgs(): string[] {
  // process.argv: [node, script, ...args]
  const script = process.argv[1]
  if (!script) return []

  // 如果是通过 bin/cah.js 启动，直接使用
  if (script.endsWith('bin/cah.js') || script.endsWith('bin/cah')) {
    return [script]
  }

  // 如果是 dist 文件（如 dist/cli/index.js），替换为 bin/cah.js
  // 避免 rebuild 后 chunk hash 变化导致模块找不到
  if (script.includes('/dist/')) {
    const projectRoot = script.split('/dist/')[0]
    return [projectRoot + '/bin/cah.js']
  }

  // Fallback: 使用原脚本路径
  return [script]
}

/** Handle selfcheck failure: auto-fix fixable issues, generate repair tasks, and notify */
async function handleSelfcheckFailure(report: SelfcheckReport): Promise<void> {
  // Try auto-fix for fixable failures
  const fixableChecks = report.checks.filter(c => c.status === 'fail' && c.fixable && c.fix)
  if (fixableChecks.length > 0) {
    logger.info(`Attempting auto-fix for ${fixableChecks.length} fixable issue(s)`)
    const fixes = await runFixes(report)
    for (const fix of fixes) {
      logger.info(`Fixed: ${fix}`)
    }
  }

  // Generate repair task for unfixable failures (self-healing loop)
  const repairResult = await generateRepairTask(report)
  if (repairResult) {
    logger.info(`Created repair task: ${repairResult.taskId}`)
  }

  // Send notification for failures
  const failedChecks = report.checks.filter(c => c.status === 'fail')
  const lines = [
    `⚠️ 健康检查异常 (${report.totalScore}/100)`,
    '',
    ...failedChecks.map(c => {
      const diagnosis = c.diagnosis ? ` — ${c.diagnosis.rootCause}` : ''
      return `✗ ${c.name} (${c.score}/100)${diagnosis}`
    }),
  ]

  try {
    const { getNotifyConfig } = await import('../config/index.js')
    const notifyConfig = await getNotifyConfig()

    // Lark notification
    const { getDefaultLarkChatId } = await import('../messaging/larkWsClient.js')
    const larkChatId = notifyConfig?.lark?.chatId || getDefaultLarkChatId()
    if (larkChatId) {
      const { sendLarkMessageViaApi } = await import('../messaging/sendLarkNotify.js')
      await sendLarkMessageViaApi(larkChatId, lines.join('\n'))
    }

    // Telegram notification
    const { getDefaultChatId: getDefaultTelegramChatId } = await import('../messaging/telegramClient.js')
    const tg = notifyConfig?.telegram
    if (tg?.botToken) {
      const tgChatId = tg.chatId || getDefaultTelegramChatId()
      if (tgChatId) {
        const { sendTelegramTextMessage } = await import('../messaging/sendTelegramNotify.js')
        await sendTelegramTextMessage(lines.join('\n'), tgChatId)
      }
    }
  } catch (error) {
    logger.warn(`Failed to send selfcheck failure notification: ${error}`)
  }
}

/** 实际运行守护进程（前台阻塞） */
async function runDaemon(): Promise<void> {
  // Remove CLAUDECODE env var early — daemon may be started from a Claude Code session,
  // and all child processes (task workers, queue runners) would inherit it, causing
  // "cannot be launched inside another Claude Code session" errors.
  delete process.env.CLAUDECODE
  delete process.env.CLAUDE_CODE_ENTRYPOINT

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

  // Register task event → notification bridge
  registerTaskEventListeners()

  // 启用配置文件监听（自动重载）
  const config = await loadConfig({ watch: true })
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

  // Periodic selfcheck — every 30 minutes
  const selfcheckJob = cron.schedule('*/30 * * * *', async () => {
    try {
      const report = await runSelfcheck()
      if (report.hasFailed) {
        logger.warn(`Selfcheck failed (score: ${report.totalScore}/100)`)
        await handleSelfcheckFailure(report)
      } else {
        logger.debug(`Selfcheck passed (score: ${report.totalScore}/100)`)
      }
    } catch (error) {
      logger.error(`Selfcheck cron error: ${error}`)
    }
  })
  scheduledJobs.push(selfcheckJob)

  // Periodic evolution cycle — every hour, run evolution for all personas
  const evolutionJob = cron.schedule('0 * * * *', () => {
    try {
      for (const persona of Object.values(BUILTIN_PERSONAS)) {
        const report = runEvolutionCycle(persona.name)
        if (report.activeVersion) {
          logger.debug(
            `Evolution [${persona.name}]: active=v${report.activeVersion.version} ` +
              `(${(report.activeVersion.successRate * 100).toFixed(0)}% success, ${report.activeVersion.totalTasks} tasks), ` +
              `candidates=${report.candidateVersions}, trend=${report.failureTrend}`
          )
        }
      }
    } catch (error) {
      logger.debug(`Evolution cron error: ${error}`)
    }
  })
  scheduledJobs.push(evolutionJob)

  // Configure and restore chat sessions from disk before starting notification platforms
  configureSession(config.backend.chat.session)
  loadSessions()

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
  resumeSelfDriveIfEnabled()
  console.log(chalk.green(`✓ 守护进程运行中 (PID: ${process.pid})`))
  console.log(chalk.gray('  Ctrl+C 停止'))

  // Synchronous cleanup — safe to call from crash handlers
  const cleanupSync = () => {
    stopSelfDrive()
    stopSleepPrevention()
    stopAllJobs()
    destroyChatHandler()
    stopTelegramClient()
    releasePidLock()
  }

  // Full async cleanup for graceful shutdown
  const cleanup = async (exitCode: number) => {
    console.log(chalk.yellow('\n停止守护进程...'))
    cleanupSync()
    try {
      await stopLarkWsClient()
    } catch {
      // Best-effort
    }
    try {
      const { stopConfigWatch } = await import('../config/loadConfig.js')
      stopConfigWatch()
    } catch {
      // Best-effort
    }
    process.exit(exitCode)
  }

  process.on('SIGINT', () => cleanup(0))
  process.on('SIGTERM', () => cleanup(0))

  // Crash handlers: do as much cleanup as possible synchronously,
  // then attempt async cleanup with a timeout to avoid hanging
  process.on('uncaughtException', error => {
    console.error(chalk.red('Uncaught exception:'), error)
    cleanupSync()
    // Attempt async cleanup with a hard timeout
    stopLarkWsClient()
      .catch(() => {})
      .finally(() => process.exit(1))
    setTimeout(() => process.exit(1), 3000)
  })

  process.on('unhandledRejection', reason => {
    console.error(chalk.red('Unhandled rejection:'), reason)
    cleanupSync()
    stopLarkWsClient()
      .catch(() => {})
      .finally(() => process.exit(1))
    setTimeout(() => process.exit(1), 3000)
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
