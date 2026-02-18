/**
 * CLI: task list + show sub-commands
 */

import type { Command } from 'commander'
import { listTasks, getTaskDetail } from '../../task/queryTask.js'

export function registerTaskListCommands(task: Command) {
  task
    .command('list')
    .description('列出任务队列')
    .option('-s, --status <status>', '按状态筛选')
    .option('-a, --agent <agent>', '按 Agent 筛选')
    .option('--source <source>', '按来源筛选 (如 selfdrive)')
    .option('--no-progress', '隐藏进度显示')
    .option('-w, --watch', '持续更新模式')
    .option('-i, --interval <ms>', '更新间隔 (毫秒)', '2000')
    .action(async options => {
      await listTasks({
        ...options,
        interval: parseInt(options.interval, 10),
      })
    })

  task
    .command('show')
    .alias('get')
    .description('查看任务详情')
    .argument('<id>', '任务 ID')
    .option('--json', '以 JSON 格式输出')
    .option('--verbose', '显示详细信息(包括节点状态)')
    .action(async (id, options) => {
      await getTaskDetail(id, { json: options.json, verbose: options.verbose })
    })
}
