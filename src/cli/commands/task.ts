/**
 * CLI: task command registration entry point
 *
 * Split into:
 * - taskCreate.ts — add sub-command
 * - taskList.ts — list + show sub-commands
 * - taskLogs.ts — logs + stats sub-commands
 * - taskLifecycle.ts — delete, stop, clear, complete, reject, resume, pause, snapshot, msg, inject-node
 */

import { Command } from 'commander'
import { registerTaskCreateCommands } from './taskCreate.js'
import { registerTaskListCommands } from './taskList.js'
import { registerTaskLogsCommands } from './taskLogs.js'
import { registerTaskLifecycleCommands } from './taskLifecycle.js'
import { registerTraceCommand } from './trace.js'

export function registerTaskCommands(program: Command) {
  const task = program.command('task').description('任务管理命令')

  registerTaskCreateCommands(task)
  registerTaskListCommands(task)
  registerTaskLogsCommands(task)
  registerTaskLifecycleCommands(task)

  // 注册 trace 子命令
  registerTraceCommand(task)
}
