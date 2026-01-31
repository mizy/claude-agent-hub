#!/usr/bin/env node
/**
 * @entry Claude Agent Hub CLI 主入口
 *
 * 核心命令：
 *   cah "任务描述"           - 创建任务并自动执行
 *   cah <file.md>            - 从 Markdown 创建工作流
 *   cah run                  - 执行待处理任务
 *   cah task list            - 查看任务列表
 *
 * 子命令：
 *   cah task      - 任务管理
 *   cah workflow  - 工作流管理
 *   cah agent     - Agent 管理
 *   cah daemon    - 守护进程
 */

import { Command } from 'commander'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import chalk from 'chalk'
import { registerAgentCommands } from './commands/agent.js'
import { registerTaskCommands } from './commands/task.js'
import { registerDaemonCommands } from './commands/daemon.js'
import { registerReportCommands } from './commands/report.js'
import { registerInitCommand } from './commands/init.js'
import { createWorkflowCommand } from './commands/workflow.js'
import { runTasks } from '../agent/runTasks.js'
import { runAgentForTask } from '../agent/runAgentForTask.js'
import { getOrCreateDefaultAgent } from '../agent/getDefaultAgent.js'
import { getStore } from '../store/index.js'
// TODO: 支持前台模式的流式输出 (stream option in invokeClaudeCode)
import { setLogLevel } from '../shared/logger.js'
import { createTaskWithFolder } from '../task/createTaskWithFolder.js'
import { spawnTaskProcess } from '../task/spawnTask.js'
import { detectOrphanedTasks, resumeAllOrphanedTasks } from '../task/resumeTask.js'
import {
  parseMarkdown,
  validateMarkdown,
  saveWorkflow,
  startWorkflow,
} from '../workflow/index.js'
import { success, error, info, warn } from './output.js'

const program = new Command()

program
  .name('cah')
  .description('Claude Agent Hub - AI 团队协作系统')
  .version('0.1.0')
  .argument('[input]', '任务描述或文件路径')
  .option('-p, --priority <priority>', '优先级 (low/medium/high)', 'medium')
  .option('-a, --agent <agent>', '指定执行的 Agent')
  .option('-F, --foreground', '前台运行 (便于调试，可看到完整日志)')
  .option('-v, --verbose', '显示详细日志 (debug 级别)')
  .option('--no-start', '创建工作流但不启动')
  .option('--no-run', '仅创建任务，不自动执行')
  .action(async (input, options) => {
    // 如果有输入参数，判断是任务描述还是文件
    if (input) {
      // 处理 ~ 开头的路径
      const resolvedInput = input.startsWith('~')
        ? input.replace('~', homedir())
        : input

      // 判断是否是 markdown 文件
      const isMarkdownPath = input.endsWith('.md') || input.includes('/')

      if (isMarkdownPath && existsSync(resolvedInput)) {
        // 作为 markdown 文件处理
        await handleMarkdownFile(resolvedInput, options)
      } else if (isMarkdownPath && !existsSync(resolvedInput)) {
        // 路径格式但文件不存在，回退到创建任务
        // 用户可能输入了带路径的描述（如 ~/nonexistent.md 实际上是个任务描述）
        await handleTaskDescription(input, options)
      } else {
        // 作为任务描述处理
        await handleTaskDescription(input, options)
      }
    }
  })

/**
 * 处理 Markdown 文件，创建工作流
 */
async function handleMarkdownFile(
  filepath: string,
  options: { start?: boolean }
): Promise<void> {
  try {
    const content = await readFile(filepath, 'utf-8')

    // 验证格式
    const validation = validateMarkdown(content)
    if (!validation.valid) {
      error('Invalid markdown format:')
      for (const err of validation.errors) {
        console.log(`  - ${err}`)
      }
      return
    }

    // 解析并保存
    const workflow = parseMarkdown(content, filepath)
    saveWorkflow(workflow)

    const taskCount = workflow.nodes.filter(
      n => n.type !== 'start' && n.type !== 'end'
    ).length

    success(`Created workflow: ${workflow.name}`)
    console.log(`  ID: ${workflow.id}`)
    console.log(`  Tasks: ${taskCount}`)

    // 自动启动（除非 --no-start）
    if (options.start !== false) {
      const instance = await startWorkflow(workflow.id)
      info(`Workflow started`)
      console.log(`  Instance: ${instance.id.slice(0, 8)}`)
    }
  } catch (err) {
    error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

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

    // 2. 如果不是 --no-run，执行任务
    if (options.run !== false) {
      if (options.foreground) {
        // 前台运行 - 直接执行，可以看到完整日志
        info('Running in foreground mode (Ctrl+C to cancel)...')
        console.log()

        // 前台模式启用 debug 日志
        setLogLevel('debug')

        const store = getStore()
        const agentName = options.agent || 'default'
        let agent = store.getAgent(agentName)
        if (!agent) {
          agent = await getOrCreateDefaultAgent()
        }

        await runAgentForTask(agent, task)
        success('Task completed!')
      } else {
        // 后台运行
        const pid = spawnTaskProcess({
          taskId: task.id,
          agentName: options.agent || 'default',
        })
        info(`Task started in background (PID: ${pid})`)
        info(`Check status: cah task show ${task.id.slice(0, 16)}`)
      }
    } else {
      info('Task queued (use cah run to execute)')
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
      await runTasks()
      success('Task execution completed')
    } catch (err) {
      error(`Execution failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

// 注册子命令
registerInitCommand(program)
registerAgentCommands(program)
registerTaskCommands(program)
program.addCommand(createWorkflowCommand())
registerDaemonCommands(program)
registerReportCommands(program)

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
