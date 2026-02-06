#!/usr/bin/env node
// @bootstrap - 自举能力已验证 2026-02-01
/**
 * @entry Claude Agent Hub CLI 主入口
 *
 * 核心命令：
 *   cah "任务描述"           - 创建任务（加入队列）
 *   cah "任务描述" -F        - 创建并立即执行（前台）
 *   cah run                  - 执行队列中的待处理任务
 *   cah task list            - 查看任务列表
 *
 * 子命令：
 *   cah task      - 任务管理
 *   cah template  - 模板管理
 *   cah daemon    - 守护进程
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { registerTaskCommands } from './commands/task.js'
import { registerDaemonCommands } from './commands/daemon.js'
import { registerReportCommands } from './commands/report.js'
import { registerTemplateCommands } from './commands/template.js'
import { registerInitCommand } from './commands/init.js'
import { registerAgentCommands } from './commands/agent.js'
import { registerServerCommand } from './commands/server.js'
import { runTask } from '../task/runTask.js'
import { executeTask } from '../task/executeTask.js'
import { pollPendingTask } from '../task/queryTask.js'
import { getTaskFolder, getAllTasks } from '../store/TaskStore.js'
import { getLogPath } from '../store/TaskLogStore.js'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
// TODO: 支持前台模式的流式输出 (stream option in invokeClaudeCode)
import { setLogLevel } from '../shared/logger.js'
import { createTaskWithFolder } from '../task/createTaskWithFolder.js'
import { detectOrphanedTasks, resumeAllOrphanedTasks } from '../task/resumeTask.js'
import { success, error, info, warn } from './output.js'
import { isRunningStatus, isPendingStatus } from '../types/taskStatus.js'
import { findClosestMatch } from '../shared/levenshtein.js'

// 已知的 CLI 命令列表
const KNOWN_COMMANDS = ['task', 'template', 'tpl', 'report', 'daemon', 'agent', 'init', 'run', 'logs', 'server']

const program = new Command()

program
  .name('cah')
  .description('Claude Agent Hub - AI 团队协作系统')
  .version('0.1.0')
  .argument('[input]', '任务描述')
  .option('-p, --priority <priority>', '优先级 (low/medium/high)', 'medium')
  .option('-a, --agent <agent>', '指定执行的 Agent')
  .option('-F, --foreground', '立即前台执行（默认只创建任务）')
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
  options: { priority?: string; agent?: string; run?: boolean; foreground?: boolean; verbose?: boolean }
): Promise<void> {
  try {
    // 启用 debug 日志
    if (options.verbose) {
      setLogLevel('debug')
    }

    // 1. 创建任务（只保存元数据，不执行）
    const task = createTaskWithFolder({
      description,
      priority: options.priority,
      assignee: options.agent,
    })

    // 截断长标题用于显示
    const displayTitle =
      task.title.length > 50 ? task.title.slice(0, 47) + '...' : task.title

    success(`Created task: ${displayTitle}`)
    console.log(`  ID: ${task.id}`)

    // --no-run: 仅创建任务，不执行
    if (options.run === false) {
      info('Task created (--no-run). Use "cah run" or "cah task resume" to execute.')
      return
    }

    // 2. 执行任务
    if (options.foreground) {
      // -F 前台运行 - 直接执行，可以看到完整日志
      info('Running in foreground mode (Ctrl+C to cancel)...')
      console.log()

      // 前台模式启用 debug 日志
      setLogLevel('debug')

      await runTask(task)
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
    error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// cah run - 执行待处理任务
program
  .command('run')
  .description('执行待处理任务')
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

      // 执行任务
      await executeTask(task, {
        concurrency: 1,
        saveToTaskFolder: false, // 保存到全局 outputs/
        useConsole: true, // 使用 console.log
      })

      success('Task execution completed')
    } catch (err) {
      error(`Execution failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

// 注册子命令
registerInitCommand(program)
registerTaskCommands(program)
registerAgentCommands(program)
registerDaemonCommands(program)
registerReportCommands(program)
registerTemplateCommands(program)
registerServerCommand(program)

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
    tail.on('error', (err) => {
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
      const title = task.title.length > 40 ? task.title.slice(0, 37) + '...' : task.title
      console.log(chalk.gray(`  [${task.status}] ${title} (was PID: ${pid})`))
    }

    console.log()

    // 自动恢复所有孤立任务
    const resumed = resumeAllOrphanedTasks()

    if (resumed.length > 0) {
      success(`Resumed ${resumed.length} task(s)`)
      for (const { taskId, pid } of resumed) {
        const shortId = taskId.length > 30 ? taskId.slice(0, 27) + '...' : taskId
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
