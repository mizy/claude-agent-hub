#!/usr/bin/env node
// @bootstrap - 自举能力已验证 2026-02-01
/**
 * @entry Claude Agent Hub CLI 主入口
 *
 * 核心命令：
 *   cah "任务描述"           - 创建并后台执行任务
 *   cah "任务描述" -F        - 前台运行（实时查看日志）
 *   cah task list            - 查看任务列表
 *
 * 守护进程：
 *   cah start               - 启动守护进程（前台阻塞）
 *   cah stop                - 停止守护进程
 *   cah restart              - 重启守护进程
 *   cah status              - 查看运行状态
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { registerTaskCommands } from './commands/task.js'
import { registerDaemonCommands } from './commands/daemon.js'
import { registerReportCommands } from './commands/report.js'

import { registerInitCommand } from './commands/init.js'
import { registerAgentCommands } from './commands/agent.js'
import { registerMemoryCommands } from './commands/memory.js'
import { registerPromptCommands } from './commands/prompt.js'
import { registerDashboardCommand } from './commands/server.js'
import { registerBackendCommands } from './commands/backend.js'
import { registerSelfCommand } from './commands/self.js'
import { registerScheduleCommand } from './commands/schedule.js'
import { runTask } from '../task/runTask.js'
import { executeTask } from '../task/executeTask.js'
import { pollPendingTask, getAllTasks, listTasks } from '../task/queryTask.js'
import { getTaskFolder, getLogPath } from '../task/index.js'
import { withProcessTracking } from '../task/processTracking.js'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { setLogLevel } from '../shared/logger.js'
import { createTaskWithFolder } from '../task/createTaskWithFolder.js'
import { detectOrphanedTasks, resumeAllOrphanedTasks } from '../task/resumeTask.js'
import { success, error, info, warn } from './output.js'
import { isRunningStatus, isPendingStatus } from '../types/taskStatus.js'
import { findClosestMatch } from '../shared/levenshtein.js'
import { truncateText } from '../shared/truncateText.js'
import { getErrorMessage } from '../shared/assertError.js'
import { registerTaskEventListeners } from '../messaging/registerTaskEventListeners.js'

/** Options that consume the next argv as value (for positional counting) */
const OPTIONS_WITH_VALUE = new Set([
  '-p', '--priority',
  '-a', '--agent',
  '-d', '--data-dir',
  '-t', '--task',
  '-b', '--backend',
  '-m', '--model',
  '-S', '--schedule',
])

/**
 * Return positional args from argv (args that are not options or option values).
 * Used to enforce: task description must be a single quoted argument.
 */
function getPositionalArgs(argv: string[]): string[] {
  const positionals: string[] = []
  const args = argv.slice(2) // skip node, script
  let i = 0
  while (i < args.length) {
    const a = args[i]!
    if (a.startsWith('-')) {
      i++
      if (OPTIONS_WITH_VALUE.has(a) && i < args.length) {
        i++ // skip option value
      }
      continue
    }
    positionals.push(a)
    i++
  }
  return positionals
}

// 已知的 CLI 命令列表
const KNOWN_COMMANDS = [
  'task',
  'report',
  'start',
  'stop',
  'restart',
  'status',
  'agent',
  'init',
  'run',
  'list',
  'logs',
  'dashboard',
  'memory',
  'prompt',
  'backend',
  'self',
  'schedule',
]

// Bridge task lifecycle events to messaging notifications
registerTaskEventListeners()

const program = new Command()

program
  .name('cah')
  .description('Claude Agent Hub - AI 团队协作系统')
  .version('0.1.0')
  .enablePositionalOptions()
  .argument('[input]', '任务描述')
  .option('-p, --priority <priority>', '优先级 (low/medium/high)', 'medium')
  .option('-a, --agent <agent>', '指定执行的 Agent')
  .option('-b, --backend <type>', '指定 backend（如 claude-code, opencode, iflow, codebuddy）')
  .option('-m, --model <model>', '指定模型')
  .option('-S, --schedule <cron>', '定时执行（cron 表达式，如 "0 9 * * *"）')
  .option('-F, --foreground', '前台执行（默认后台运行）')
  .option('--no-run', '仅创建任务，不执行')
  .option('-v, --verbose', '显示详细日志 (debug 级别)')
  .option('-d, --data-dir <path>', '数据存储目录（默认: ./.cah-data）')
  .action(async (input, options) => {
    // 数据目录已在 bin/cah.js 入口处理
    // 处理空输入：空字符串或纯空白字符
    if (input !== undefined && input.trim().length === 0) {
      error('任务描述不能为空')
      console.log(chalk.gray('  请使用 cah "描述" 创建任务'))
      console.log(chalk.gray('  或使用 cah --help 查看帮助'))
      process.exit(1)
    }
    if (input) {
      // 多个未引号的词被 shell 拆成多个 positional args → 提示用户加引号
      const positionals = getPositionalArgs(process.argv)
      if (positionals.length > 1) {
        error('请使用双引号或单引号将任务描述括起来')
        console.log(chalk.gray('  例如: cah "任务描述"  或  cah \'任务描述\''))
        console.log(chalk.gray('  或使用 cah --help 查看帮助'))
        process.exit(1)
      }

      // 检测是否可能是拼错的命令
      const firstWord = input.split(/\s+/)[0].toLowerCase()
      const match = findClosestMatch(firstWord, KNOWN_COMMANDS)

      // 如果输入是单个单词且可能是命令拼写错误
      if (match && input.trim().split(/\s+/).length === 1) {
        warn(`未找到命令 "${firstWord}"`)
        console.log(chalk.gray(`  您是否想输入: cah ${match.match}`))
        console.log(chalk.gray(`  如果要创建任务: cah "${input}"`))
        process.exit(1)
      }

      await handleTaskDescription(input, options)
    }
  })

/**
 * 处理任务描述，创建任务
 */
async function handleTaskDescription(
  description: string,
  options: {
    priority?: string
    agent?: string
    backend?: string
    model?: string
    schedule?: string
    run?: boolean
    foreground?: boolean
    verbose?: boolean
  }
): Promise<void> {
  try {
    // 启用 debug 日志
    if (options.verbose) {
      setLogLevel('debug')
    }

    // 1. 创建任务（只保存元数据，不执行）
    let task
    try {
      task = createTaskWithFolder({
        description,
        priority: options.priority,
        assignee: options.agent,
        backend: options.backend,
        model: options.model,
        schedule: options.schedule,
      })
    } catch (e) {
      if (options.schedule) {
        error(`Invalid cron expression: "${options.schedule}"`)
        console.log('  Examples: "0 9 * * *" (daily 9am), "*/30 * * * *" (every 30min), "0 0 * * 1" (weekly Monday)')
        return
      }
      throw e
    }

    const displayTitle = truncateText(task.title, 50)

    success(`Created task: ${displayTitle}`)
    console.log(`  ID: ${task.id}`)

    // --no-run: 仅创建任务，不执行
    if (options.run === false) {
      info('Task created (--no-run). Use "cah run" or "cah task resume" to execute.')
      return
    }

    // 2. 检测同项目冲突
    const cwd = process.cwd()
    const allTasksNow = getAllTasks()
    const sameProjectRunning = allTasksNow.filter(
      t => isRunningStatus(t.status) && t.cwd === cwd
    )
    if (sameProjectRunning.length > 0) {
      warn(`同项目有 ${sameProjectRunning.length} 个任务正在运行，将排队等待:`)
      for (const t of sameProjectRunning) {
        console.log(chalk.gray(`  [${t.status}] ${truncateText(t.title, 40)} (${t.id})`))
      }
    }

    // 3. 执行任务
    if (options.foreground) {
      // -F 前台运行 - 直接执行，可以看到完整日志
      info('Running in foreground mode (Ctrl+C to cancel)...')
      console.log()

      // 前台模式启用 debug 日志
      setLogLevel('debug')

      await withProcessTracking(task.id, () => runTask(task))
      success('Task completed!')
    } else {
      // 默认：创建任务后立即触发队列执行（后台）
      const { spawnTaskRunner } = await import('../task/spawnTask.js')

      // 检测 pending 任务数量（包括刚创建的）
      const allTasks = getAllTasks()
      const pendingTasks = allTasks.filter(t => isPendingStatus(t.status))
      const runningTasks = allTasks.filter(t => isRunningStatus(t.status))

      if (runningTasks.length > 0) {
        // 有任务在运行，新任务排队等待
        info(`Task queued. ${runningTasks.length} running, ${pendingTasks.length} pending.`)
      } else if (pendingTasks.length > 1) {
        // 有其他 pending 任务
        info(`Task queued. ${pendingTasks.length} pending tasks in queue.`)
      }

      spawnTaskRunner()

      if (runningTasks.length === 0 && pendingTasks.length <= 1) {
        info('Task queued and runner started.')
      }
    }
  } catch (err) {
    error(`Failed: ${getErrorMessage(err)}`)
  }
}

// cah run - 手动执行队列中下一个待处理任务
program
  .command('run')
  .description('手动执行队列中下一个待处理任务')
  .action(async () => {
    try {
      info('Starting task execution...')

      // 轮询获取任务
      const task = await pollPendingTask()
      if (!task) {
        info('No pending tasks')
        return
      }

      info(`Executing task: ${task.title}`)

      await withProcessTracking(task.id, () =>
        executeTask(task, { concurrency: 1, useConsole: true })
      )

      success('Task execution completed')
    } catch (err) {
      error(`Execution failed: ${getErrorMessage(err)}`)
    }
  })

// 注册子命令
registerInitCommand(program)
registerTaskCommands(program)
registerAgentCommands(program)
registerDaemonCommands(program)
registerReportCommands(program)
registerMemoryCommands(program)
registerPromptCommands(program)
registerDashboardCommand(program)
registerBackendCommands(program)
registerSelfCommand(program)
registerScheduleCommand(program)

// cah list - 查看任务列表的快捷命令
program
  .command('list')
  .alias('ls')
  .description('列出任务队列 (cah task list 的快捷方式)')
  .option('-s, --status <status>', '按状态筛选')
  .option('-a, --agent <agent>', '按 Agent 筛选')
  .option('--source <source>', '按来源筛选 (如 selfdrive)')
  .option('--cwd <path>', '按项目目录筛选')
  .option('--project', '只显示当前目录的任务')
  .option('--no-progress', '隐藏进度显示')
  .option('-w, --watch', '持续更新模式')
  .option('-i, --interval <ms>', '更新间隔 (毫秒)', '2000')
  .action(async options => {
    const cwd = options.cwd ?? (options.project ? process.cwd() : undefined)
    await listTasks({
      ...options,
      cwd,
      interval: parseInt(options.interval, 10),
    })
  })

// cah logs <id> - 查看任务日志的快捷命令
program
  .command('logs')
  .description('查看任务执行日志 (cah task logs 的快捷方式)')
  .argument('<id>', '任务 ID')
  .option('-f, --follow', '持续跟踪 (类似 tail -f)')
  .option('-n, --lines <n>', '显示最后 N 行', '50')
  .action((id, options) => {
    const taskFolder = getTaskFolder(id)
    if (!taskFolder) {
      error(`Task not found: ${id}`)
      return
    }

    const logPath = getLogPath(id)
    if (!existsSync(logPath)) {
      warn(`No logs yet for task: ${id}`)
      console.log(`  Log path: ${logPath}`)
      return
    }

    info(`Tailing logs for task: ${id}`)
    console.log(`  Path: ${logPath}`)
    console.log(`  Press Ctrl+C to stop\n`)

    const tailArgs = ['-n', options.lines]
    if (options.follow) {
      tailArgs.push('-f')
    }
    tailArgs.push(logPath)

    const tail = spawn('tail', tailArgs, { stdio: 'inherit' })
    tail.on('error', err => {
      error(`Failed to tail logs: ${err.message}`)
    })
  })

/**
 * 检测并自动恢复孤立任务
 * 当电脑关机后任务进程被杀，下次启动 cah 时自动恢复
 */
function checkAndResumeOrphanedTasks(): void {
  try {
    const orphaned = detectOrphanedTasks()

    if (orphaned.length === 0) {
      return
    }

    console.log()
    warn(`Detected ${orphaned.length} interrupted task(s), resuming...`)
    console.log()

    for (const { task, pid } of orphaned) {
      const title = truncateText(task.title, 40)
      console.log(chalk.gray(`  [${task.status}] ${title} (was PID: ${pid})`))
    }

    console.log()

    // 自动恢复所有孤立任务
    const resumed = resumeAllOrphanedTasks()

    if (resumed.length > 0) {
      success(`Resumed ${resumed.length} task(s)`)
      for (const { taskId, pid } of resumed) {
        const shortId = truncateText(taskId, 30)
        console.log(chalk.gray(`  ${shortId} → PID ${pid}`))
      }
      console.log()
      info('Use "cah task list" to check status')
      console.log()
    }
  } catch {
    // 静默失败，不影响正常命令执行
  }
}

// 在解析命令前检查孤立任务
checkAndResumeOrphanedTasks()

program.parse()
