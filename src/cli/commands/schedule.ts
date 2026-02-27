/**
 * CLI: schedule sub-commands — create and manage scheduled (cron) tasks
 */

import type { Command } from 'commander'
import chalk from 'chalk'
import { CronExpressionParser } from 'cron-parser'
import { success, error, info } from '../output.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { truncateText } from '../../shared/truncateText.js'

export function registerScheduleCommand(program: Command) {
  const schedule = program
    .command('schedule')
    .description('定时任务管理')

  // cah schedule <cron> <description> — create a scheduled task with preset workflow
  schedule
    .command('create')
    .alias('add')
    .description('创建定时任务（自动构建 schedule-wait workflow）')
    .argument('<cron>', 'Cron 表达式（如 "0 9 * * 1-5"）')
    .argument('<description>', '任务描述')
    .option('-a, --agent <agent>', '指定执行 Agent (persona)', 'coder')
    .option('-b, --backend <type>', '指定 backend')
    .option('-m, --model <model>', '指定模型')
    .action(async (cron: string, description: string, options) => {
      try {
        // 1. Validate cron expression
        try {
          CronExpressionParser.parse(cron)
        } catch {
          error(`Invalid cron expression: "${cron}"`)
          console.log('  Examples: "0 9 * * *" (daily 9am), "*/30 * * * *" (every 30min), "0 0 * * 1" (weekly Monday)')
          return
        }

        // Show next run time
        const interval = CronExpressionParser.parse(cron, { tz: 'Asia/Shanghai' })
        const nextRun = interval.next().toISOString()
        info(`Cron: ${chalk.cyan(cron)} → next: ${nextRun}`)

        // 2. Create task
        const { createTaskWithFolder } = await import('../../task/createTaskWithFolder.js')
        const task = createTaskWithFolder({
          description,
          schedule: cron,
          assignee: options.agent,
          backend: options.backend,
          model: options.model,
          source: 'scheduled',
        })

        // 3. Build preset workflow
        const { parseJson } = await import('../../workflow/parser/parseJson.js')
        const { saveTaskWorkflow } = await import('../../store/TaskWorkflowStore.js')

        const persona = options.agent || 'coder'
        const workflowInput = {
          name: `定时任务: ${truncateText(description, 40)}`,
          description,
          nodes: [
            { id: 'start', type: 'start' as const, name: 'Start' },
            {
              id: 'wait',
              type: 'schedule-wait' as const,
              name: '等待定时触发',
              scheduleWait: { cron, timezone: 'Asia/Shanghai' },
            },
            {
              id: 'action',
              type: 'task' as const,
              name: truncateText(description, 30),
              task: { persona, prompt: description },
            },
            {
              id: 'notify',
              type: 'lark-notify' as const,
              name: '通知完成',
              larkNotify: { content: `定时任务完成: ${truncateText(description, 30)}` },
            },
            { id: 'end', type: 'end' as const, name: 'End' },
          ],
          edges: [
            { from: 'start', to: 'wait' },
            { from: 'wait', to: 'action' },
            { from: 'action', to: 'notify' },
            { from: 'notify', to: 'wait' },  // loop back for recurring
          ],
          variables: {},
        }

        const workflow = parseJson(workflowInput)
        workflow.taskId = task.id
        saveTaskWorkflow(task.id, workflow)

        success(`Created scheduled task: ${truncateText(task.title, 50)}`)
        console.log(`  ID: ${task.id}`)
        console.log(`  Cron: ${chalk.cyan(cron)}`)
        console.log(`  Next: ${nextRun}`)

        // 4. Start execution (spawn runner)
        const { spawnTaskRunner } = await import('../../task/spawnTask.js')
        spawnTaskRunner()
        info('Task queued and runner started.')
      } catch (err) {
        error(`Failed: ${getErrorMessage(err)}`)
      }
    })

  // cah schedule list — list scheduled tasks
  schedule
    .command('list')
    .alias('ls')
    .description('列出所有定时任务')
    .action(async () => {
      const { getAllTasks } = await import('../../store/TaskStore.js')
      const { renderTaskList } = await import('../../task/formatTask.js')

      const tasks = getAllTasks().filter(t => !!t.scheduleCron)

      if (tasks.length === 0) {
        info('暂无定时任务')
        console.log(chalk.gray('  使用 cah schedule create "cron" "描述" 创建'))
        return
      }

      console.log(chalk.bold(`定时任务 (${tasks.length}):`))
      console.log()
      renderTaskList(tasks, false)
    })

  // cah schedule stop <id> — stop a scheduled task
  schedule
    .command('stop')
    .description('停止定时任务')
    .argument('<id>', '任务 ID 或前缀')
    .action(async (id: string) => {
      const { stopTask } = await import('../../task/stopTask.js')
      const { getAllTasks } = await import('../../store/TaskStore.js')

      // Resolve task ID prefix
      const tasks = getAllTasks().filter(t => !!t.scheduleCron)
      const match = tasks.find(t => t.id === id || t.id.startsWith(id))

      if (!match) {
        error(`Scheduled task not found: ${id}`)
        return
      }

      const result = stopTask(match.id)
      if (result.success) {
        success(`Stopped scheduled task: ${truncateText(match.title, 50)}`)
      } else {
        error(`Failed to stop: ${result.error}`)
      }
    })
}
