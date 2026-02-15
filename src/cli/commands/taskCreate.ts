/**
 * CLI: task add sub-command
 */

import type { Command } from 'commander'
import { createTask } from '../../task/createTask.js'
import { success, list } from '../output.js'

export function registerTaskCreateCommands(task: Command) {
  task
    .command('add')
    .description('添加新任务')
    .requiredOption('-t, --title <title>', '任务标题')
    .option('-d, --description <desc>', '任务描述')
    .option('-p, --priority <priority>', '优先级 (low/medium/high)', 'medium')
    .option('-a, --assignee <agent>', '指定 Agent')
    .option('-b, --backend <type>', '指定 backend（如 claude-code, opencode, iflow）')
    .option('-m, --model <model>', '指定模型')
    .action(async options => {
      const task = await createTask(options)
      success('任务创建成功')
      const items = [
        { label: 'ID', value: task.id.slice(0, 8), dim: true },
        { label: '标题', value: task.title, dim: true },
        { label: '优先级', value: task.priority, dim: true },
      ]
      if (task.assignee) {
        items.push({ label: '指派给', value: task.assignee, dim: true })
      }
      list(items)
    })
}
