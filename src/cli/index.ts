#!/usr/bin/env node
/**
 * @entry Claude Agent Hub CLI 主入口
 *
 * 简化命令：
 *   cah "修复我的tickets"     - 直接创建任务
 *   cah ~/projects/prd.md    - 从文件创建工作流
 *
 * 子命令：
 *   cah task    - 任务管理
 *   cah agent   - Agent 管理
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
import { runDefault } from './commands/run.js'

const program = new Command()

program
  .name('cah')
  .description('Claude Agent Hub - AI Agent 调度系统')
  .version('0.1.0')
  .argument('[input]', '任务描述或文件路径')
  .option('--no-start', '创建工作流但不自动启动')
  .option('-a, --agent <name>', '指定执行 Agent')
  .action(async (input: string | undefined, options) => {
    if (input) {
      await runDefault(input, options)
    } else {
      // 无参数时显示帮助
      program.help()
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
