import { Command } from 'commander'
import chalk from 'chalk'
import { createTask } from '../../task/createTask.js'
import { listTasks } from '../../task/listTasks.js'
import { getTaskDetail } from '../../task/getTaskDetail.js'
import { deleteTask } from '../../task/deleteTask.js'
import { clearTasks } from '../../task/clearTasks.js'
import { stopTask } from '../../task/stopTask.js'
import { completeTask, rejectTask } from '../../task/completeTask.js'
import {
  detectOrphanedTasks,
  resumeTask,
  resumeAllOrphanedTasks,
} from '../../task/resumeTask.js'
import { success, error, info, warn } from '../output.js'
import type { TaskStatus } from '../../types/task.js'

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

  task
    .command('delete')
    .alias('rm')
    .description('删除任务')
    .argument('<id>', '任务 ID')
    .action((id) => {
      const result = deleteTask(id)
      if (result.success) {
        success(`Deleted task: ${result.task?.title}`)
        console.log(chalk.gray(`  ID: ${result.task?.id}`))
      } else {
        error(result.error || 'Failed to delete task')
      }
    })

  task
    .command('stop')
    .alias('cancel')
    .description('停止/取消任务')
    .argument('<id>', '任务 ID')
    .action((id) => {
      const result = stopTask(id)
      if (result.success) {
        success(`Stopped task: ${result.task?.title}`)
        console.log(chalk.gray(`  Status: ${result.task?.status}`))
      } else {
        error(result.error || 'Failed to stop task')
      }
    })

  task
    .command('clear')
    .description('清除任务')
    .option('-s, --status <status>', '按状态清除 (pending/completed/failed/cancelled)')
    .option('-a, --all', '清除所有任务 (包括运行中的，会杀掉进程)')
    .action((options) => {
      const result = clearTasks({
        status: options.status as TaskStatus | undefined,
        all: options.all,
      })
      if (result.success) {
        if (result.count === 0) {
          info('No tasks to clear')
        } else {
          success(`Cleared ${result.count} task(s)`)
          if (result.killedProcesses > 0) {
            console.log(chalk.gray(`  Killed ${result.killedProcesses} process(es)`))
          }
        }
      } else {
        error(result.error || 'Failed to clear tasks')
      }
    })

  task
    .command('complete')
    .alias('done')
    .description('完成任务 (审核通过)')
    .argument('<id>', '任务 ID')
    .action((id) => {
      const result = completeTask(id)
      if (result.success) {
        success(`Task completed: ${result.task?.title}`)
        console.log(chalk.gray(`  ID: ${result.task?.id}`))
      } else {
        error(result.error || 'Failed to complete task')
      }
    })

  task
    .command('reject')
    .description('驳回任务 (退回重做)')
    .argument('<id>', '任务 ID')
    .option('-r, --reason <reason>', '驳回原因')
    .action((id, options) => {
      const result = rejectTask(id, options.reason)
      if (result.success) {
        success(`Task rejected: ${result.task?.title}`)
        console.log(chalk.gray(`  Status: ${result.task?.status}`))
        console.log(chalk.gray(`  Retry count: ${result.task?.retryCount}`))
        if (options.reason) {
          console.log(chalk.gray(`  Reason: ${options.reason}`))
        }
      } else {
        error(result.error || 'Failed to reject task')
      }
    })

  task
    .command('resume')
    .description('恢复中断的任务')
    .argument('[id]', '任务 ID (不填则恢复所有孤立任务)')
    .option('-a, --all', '恢复所有孤立任务')
    .option('--agent <agent>', '指定执行的 Agent')
    .action((id, options) => {
      if (id) {
        // 恢复单个任务
        const pid = resumeTask(id, options.agent)
        if (pid) {
          success(`Task resumed: ${id}`)
          console.log(chalk.gray(`  PID: ${pid}`))
        } else {
          error('Task is still running or not found')
        }
      } else {
        // 检测并显示孤立任务
        const orphaned = detectOrphanedTasks()

        if (orphaned.length === 0) {
          info('No orphaned tasks found')
          return
        }

        console.log(chalk.yellow(`Found ${orphaned.length} orphaned task(s):\n`))
        for (const { task, pid } of orphaned) {
          const title = task.title.length > 40 ? task.title.slice(0, 37) + '...' : task.title
          console.log(chalk.gray(`  [${task.status}] ${title}`))
          console.log(chalk.gray(`    ID: ${task.id}`))
          console.log(chalk.gray(`    PID: ${pid} (dead)`))
          console.log()
        }

        if (options.all) {
          // 恢复所有孤立任务
          const resumed = resumeAllOrphanedTasks()
          if (resumed.length > 0) {
            success(`Resumed ${resumed.length} task(s)`)
            for (const { taskId, pid } of resumed) {
              console.log(chalk.gray(`  ${taskId} → PID ${pid}`))
            }
          }
        } else {
          warn('Use --all to resume all orphaned tasks, or specify a task ID')
        }
      }
    })
}
