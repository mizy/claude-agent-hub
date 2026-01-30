import { Command } from 'commander'
import { createTask } from '../../task/createTask.js'
import { listTasks } from '../../task/listTasks.js'
import { getTaskDetail } from '../../task/getTaskDetail.js'

export function registerTaskCommands(program: Command) {
  const task = program
    .command('task')
    .description('任务管理命令')

  task
    .command('add')
    .description('添加新任务')
    .requiredOption('-t, --title <title>', '任务标题')
    .option('-d, --description <desc>', '任务描述')
    .option('-p, --priority <priority>', '优先级 (low/medium/high)', 'medium')
    .option('-a, --assignee <agent>', '指定 Agent')
    .action(async (options) => {
      await createTask(options)
    })

  task
    .command('list')
    .description('列出任务队列')
    .option('-s, --status <status>', '按状态筛选')
    .option('-a, --agent <agent>', '按 Agent 筛选')
    .action(async (options) => {
      await listTasks(options)
    })

  task
    .command('show')
    .description('查看任务详情')
    .argument('<id>', '任务 ID')
    .action(async (id) => {
      await getTaskDetail(id)
    })
}
