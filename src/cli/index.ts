#!/usr/bin/env node
/**
 * @entry Claude Agent Hub CLI 主入口
 *
 * 核心命令：
 *   cah run                  - 执行待处理任务
 *   cah task add "描述"      - 添加任务
 *   cah task list            - 查看任务列表
 *
 * 子命令：
 *   cah task    - 任务管理
 *   cah workflow - 工作流管理
 *   cah daemon  - 守护进程
 */

import { Command } from 'commander'
import { registerAgentCommands } from './commands/agent.js'
import { registerTaskCommands } from './commands/task.js'
import { registerDaemonCommands } from './commands/daemon.js'
import { registerReportCommands } from './commands/report.js'
import { registerInitCommand } from './commands/init.js'
import { createWorkflowCommand } from './commands/workflow.js'
import { runTasks } from '../agent/runTasks.js'
import { success, error, info } from './output.js'

const program = new Command()

program
  .name('cah')
  .description('Claude Agent Hub - AI 团队协作系统')
  .version('0.1.0')

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
registerDaemonCommands(program)
registerReportCommands(program)
program.addCommand(createWorkflowCommand())

program.parse()
