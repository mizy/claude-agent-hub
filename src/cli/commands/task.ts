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
  resumeFailedTask,
  getFailedTasks,
} from '../../task/resumeTask.js'
import { getTask, getTaskFolder } from '../../store/TaskStore.js'
import { getLogPath } from '../../store/TaskLogStore.js'
import {
  getExecutionStats,
  getExecutionTimeline,
  formatExecutionSummary,
  formatTimeline,
} from '../../store/ExecutionStatsStore.js'
import {
  generateExecutionReport,
  formatReportForTerminal,
  formatReportForMarkdown,
} from '../../report/ExecutionReport.js'
import { writeFileSync } from 'fs'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { success, error, info, warn } from '../output.js'
import { taskNotFoundError, formatError } from '../errors.js'
import type { TaskStatus } from '../../types/task.js'

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

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
    .option('--no-progress', '隐藏进度显示')
    .option('-w, --watch', '持续更新模式')
    .option('-i, --interval <ms>', '更新间隔 (毫秒)', '2000')
    .action(async (options) => {
      await listTasks({
        ...options,
        interval: parseInt(options.interval, 10),
      })
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
    .description('恢复中断/失败的任务')
    .argument('[id]', '任务 ID (不填则显示可恢复的任务)')
    .option('-a, --all', '恢复所有孤立任务')
    .action(async (id, options) => {
      if (id) {
        // 恢复单个任务
        const task = getTask(id)
        if (!task) {
          error(`Task not found: ${id}`)
          return
        }

        if (task.status === 'failed') {
          // 恢复失败的任务 (从失败点继续，自动启动进程)
          const result = await resumeFailedTask(id)
          if (result.success) {
            success(`Failed task recovered and started: ${id}`)
            console.log(chalk.gray(`  Retrying node: ${result.failedNodeId}`))
            console.log(chalk.gray(`  PID: ${result.pid}`))
          } else {
            error(result.error || 'Failed to recover task')
          }
        } else {
          // 恢复孤立任务 (重启进程)
          const pid = resumeTask(id)
          if (pid) {
            success(`Task resumed: ${id}`)
            console.log(chalk.gray(`  PID: ${pid}`))
          } else {
            error('Task is still running or not in resumable state')
          }
        }
      } else {
        // 检测并显示可恢复的任务
        const orphaned = detectOrphanedTasks()
        const failed = getFailedTasks()

        if (orphaned.length === 0 && failed.length === 0) {
          info('No tasks to resume')
          return
        }

        if (orphaned.length > 0) {
          console.log(chalk.yellow(`\nOrphaned tasks (${orphaned.length}):\n`))
          for (const { task, pid } of orphaned) {
            const title = task.title.length > 40 ? task.title.slice(0, 37) + '...' : task.title
            console.log(chalk.gray(`  [${task.status}] ${title}`))
            console.log(chalk.gray(`    ID: ${task.id}`))
            console.log(chalk.gray(`    PID: ${pid} (dead)`))
            console.log()
          }
        }

        if (failed.length > 0) {
          console.log(chalk.red(`\nFailed tasks (${failed.length}):\n`))
          for (const task of failed) {
            const title = task.title.length > 40 ? task.title.slice(0, 37) + '...' : task.title
            console.log(chalk.gray(`  [failed] ${title}`))
            console.log(chalk.gray(`    ID: ${task.id}`))
            console.log()
          }
        }

        if (options.all && orphaned.length > 0) {
          // 恢复所有孤立任务
          const resumed = resumeAllOrphanedTasks()
          if (resumed.length > 0) {
            success(`Resumed ${resumed.length} orphaned task(s)`)
            for (const { taskId, pid } of resumed) {
              console.log(chalk.gray(`  ${taskId} → PID ${pid}`))
            }
          }
        } else {
          warn('Specify a task ID to resume, or use --all to resume all orphaned tasks')
          if (failed.length > 0) {
            console.log(chalk.gray('  For failed tasks: cah task resume <task-id>'))
          }
        }
      }
    })

  task
    .command('stats')
    .description('查看任务执行统计')
    .argument('<id>', '任务 ID')
    .option('-t, --timeline', '显示执行时间线')
    .option('-r, --report', '生成完整执行报告')
    .option('--markdown', '报告输出为 Markdown 格式')
    .option('-o, --output <file>', '保存报告到文件')
    .option('--json', '输出 JSON 格式')
    .action((id, options) => {
      const taskFolder = getTaskFolder(id)
      if (!taskFolder) {
        console.error(formatError(taskNotFoundError(id)))
        return
      }

      // 生成完整执行报告
      if (options.report || options.markdown || options.output) {
        const report = generateExecutionReport(id)
        if (!report) {
          error(`Failed to generate report for task: ${id}`)
          return
        }

        if (options.json) {
          const output = JSON.stringify(report, null, 2)
          if (options.output) {
            writeFileSync(options.output, output)
            success(`Report saved to: ${options.output}`)
          } else {
            console.log(output)
          }
          return
        }

        const formatted = options.markdown
          ? formatReportForMarkdown(report)
          : formatReportForTerminal(report)

        if (options.output) {
          writeFileSync(options.output, formatted)
          success(`Report saved to: ${options.output}`)
        } else {
          console.log(formatted)
        }
        return
      }

      // 简单统计模式 (原有逻辑)
      const stats = getExecutionStats(id)
      if (!stats) {
        warn(`No execution stats for task: ${id}`)
        info('Stats are recorded after workflow execution completes')
        return
      }

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2))
        return
      }

      // 显示汇总
      console.log(chalk.cyan('\n📊 Execution Summary\n'))
      console.log(formatExecutionSummary(stats.summary))

      // 显示节点详情
      console.log(chalk.cyan('\n📋 Node Details\n'))
      for (const node of stats.nodes) {
        const statusIcon = node.status === 'completed' ? '✓' :
                          node.status === 'failed' ? '✗' :
                          node.status === 'skipped' ? '○' : '•'
        const statusColor = node.status === 'completed' ? chalk.green :
                           node.status === 'failed' ? chalk.red :
                           node.status === 'skipped' ? chalk.gray : chalk.yellow

        const duration = node.durationMs ? ` (${formatDurationMs(node.durationMs)})` : ''
        const cost = node.costUsd ? ` $${node.costUsd.toFixed(4)}` : ''

        console.log(statusColor(`  ${statusIcon} ${node.nodeName} [${node.nodeType}]${duration}${cost}`))
        if (node.error) {
          console.log(chalk.red(`      Error: ${node.error}`))
        }
      }

      // 可选显示时间线
      if (options.timeline) {
        const timeline = getExecutionTimeline(id)
        if (timeline.length > 0) {
          console.log(chalk.cyan('\n📅 Timeline\n'))
          console.log(formatTimeline(timeline))
        }
      }

      console.log()
    })

  task
    .command('logs')
    .description('查看任务执行日志 (实时)')
    .argument('<id>', '任务 ID')
    .option('-f, --follow', '持续跟踪 (类似 tail -f)')
    .option('-n, --lines <n>', '显示最后 N 行', '50')
    .action((id, options) => {
      const taskFolder = getTaskFolder(id)
      if (!taskFolder) {
        console.error(formatError(taskNotFoundError(id)))
        return
      }

      const logPath = getLogPath(id)
      if (!existsSync(logPath)) {
        warn(`No logs yet for task: ${id}`)
        console.log(chalk.gray(`  Log path: ${logPath}`))
        return
      }

      info(`Tailing logs for task: ${id}`)
      console.log(chalk.gray(`  Path: ${logPath}`))
      console.log(chalk.gray(`  Press Ctrl+C to stop\n`))

      // 使用 tail 命令
      const tailArgs = ['-n', options.lines]
      if (options.follow) {
        tailArgs.push('-f')
      }
      tailArgs.push(logPath)

      const tail = spawn('tail', tailArgs, {
        stdio: 'inherit',
      })

      tail.on('error', (err) => {
        error(`Failed to tail logs: ${err.message}`)
      })
    })
}
