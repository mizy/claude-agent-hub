/**
 * CLI: task lifecycle sub-commands — delete, stop, clear, complete, reject,
 * resume, pause, snapshot, msg, inject-node
 */

import type { Command } from 'commander'
import chalk from 'chalk'
import {
  deleteTask,
  clearTasks,
  stopTask,
  completeTask,
  rejectTask,
  pauseTask,
  resumePausedTask,
  injectNode,
} from '../../task/manageTaskLifecycle.js'
import {
  detectOrphanedTasks,
  resumeTask,
  resumeAllOrphanedTasks,
  resumeFailedTask,
  getFailedTasks,
} from '../../task/resumeTask.js'
import { getTask } from '../../task/index.js'
import { getTaskInstance, getTaskWorkflow } from '../../store/TaskWorkflowStore.js'
import { getWorkflowProgress } from '../../workflow/index.js'
import { success, error, info, warn } from '../output.js'
import { parseTaskStatus } from '../../types/task.js'
import { truncateText } from '../../shared/truncateText.js'
import { addTaskMessage, getUnconsumedMessages } from '../../store/TaskMessageStore.js'
import { formatDuration } from '../../shared/formatTime.js'

export function registerTaskLifecycleCommands(task: Command) {
  task
    .command('delete')
    .alias('rm')
    .description('删除任务')
    .argument('<id>', '任务 ID')
    .action(id => {
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
    .action(id => {
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
    .action(options => {
      const result = clearTasks({
        status: parseTaskStatus(options.status) ?? undefined,
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
    .action(id => {
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

        if (task.status === 'paused') {
          // 恢复暂停的任务（进程仍在运行，只需修改状态）
          const result = resumePausedTask(id)
          if (result.success) {
            success(`Task resumed from pause: ${result.task?.title}`)
          } else {
            error(result.error || 'Failed to resume paused task')
          }
        } else if (task.status === 'failed') {
          // 恢复失败的任务 (从失败点继续或重新执行)
          const result = await resumeFailedTask(id)
          if (result.success) {
            if (result.mode === 'restart') {
              success(`Failed task restarted: ${id}`)
              console.log(chalk.gray(`  Mode: restart (no previous workflow)`))
            } else {
              success(`Failed task recovered and started: ${id}`)
              console.log(chalk.gray(`  Mode: continue from failed node`))
              console.log(chalk.gray(`  Retrying node: ${result.failedNodeId}`))
            }
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
            const title = truncateText(task.title, 40)
            console.log(chalk.gray(`  [${task.status}] ${title}`))
            console.log(chalk.gray(`    ID: ${task.id}`))
            console.log(chalk.gray(`    PID: ${pid} (dead)`))
            console.log()
          }
        }

        if (failed.length > 0) {
          console.log(chalk.red(`\nFailed tasks (${failed.length}):\n`))
          for (const task of failed) {
            const title = truncateText(task.title, 40)
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
    .command('pause')
    .description('暂停运行中的任务（当前节点完成后暂停）')
    .argument('<id>', '任务 ID')
    .option('-r, --reason <reason>', '暂停原因')
    .action((id, options) => {
      const result = pauseTask(id, options.reason)
      if (result.success) {
        success(`Task paused: ${result.task?.title}`)
        console.log(chalk.gray(`  Status: paused`))
        if (options.reason) {
          console.log(chalk.gray(`  Reason: ${options.reason}`))
        }
        console.log(chalk.gray(`  Use 'cah task resume ${id}' to continue`))
      } else {
        error(result.error || 'Failed to pause task')
      }
    })

  task
    .command('snapshot')
    .description('查看任务当前执行快照')
    .argument('<id>', '任务 ID')
    .option('--json', '以 JSON 格式输出')
    .action((id, options) => {
      const task = getTask(id)
      if (!task) {
        error(`Task not found: ${id}`)
        return
      }

      const instance = getTaskInstance(id)
      const workflow = getTaskWorkflow(id)

      if (!instance || !workflow) {
        warn('No workflow execution data available')
        return
      }

      // Build snapshot
      const progress = getWorkflowProgress(instance, workflow)
      const messages = getUnconsumedMessages(id)

      const snapshot = {
        taskId: task.id,
        title: task.title,
        status: task.status,
        workflowStatus: instance.status,
        paused: task.status === 'paused' || instance.status === 'paused',
        pausedAt: instance.pausedAt,
        pauseReason: instance.pauseReason,
        progress: {
          ...progress,
          bar: `${progress.completed}/${progress.total} (${progress.percentage}%)`,
        },
        nodes: workflow.nodes
          .filter(n => n.type !== 'start' && n.type !== 'end')
          .map(n => {
            const state = instance.nodeStates[n.id]
            return {
              id: n.id,
              name: n.name,
              type: n.type,
              status: state?.status || 'pending',
              attempts: state?.attempts || 0,
              durationMs: state?.durationMs,
              error: state?.error ? truncateText(state.error, 80) : undefined,
              autoWait: n.autoWait || false,
            }
          }),
        pendingMessages: messages.length,
      }

      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2))
        return
      }

      // Pretty print
      console.log(chalk.cyan(`\nTask Snapshot: ${task.title}\n`))
      console.log(chalk.gray(`  Task ID:    ${task.id}`))
      console.log(chalk.gray(`  Status:     ${task.status}`))
      console.log(chalk.gray(`  Workflow:   ${instance.status}`))
      if (snapshot.paused) {
        console.log(chalk.yellow(`  PAUSED${snapshot.pauseReason ? ` (${snapshot.pauseReason})` : ''}`))
        if (snapshot.pausedAt) {
          console.log(chalk.gray(`  Paused at:  ${snapshot.pausedAt}`))
        }
      }
      console.log(chalk.gray(`  Progress:   ${snapshot.progress.bar}`))
      if (messages.length > 0) {
        console.log(chalk.yellow(`  Messages:   ${messages.length} unconsumed`))
      }

      console.log(chalk.cyan(`\n  Nodes:\n`))
      for (const node of snapshot.nodes) {
        const statusIcon =
          node.status === 'done'
            ? chalk.green('✓')
            : node.status === 'running'
              ? chalk.yellow('▶')
              : node.status === 'failed'
                ? chalk.red('✗')
                : node.status === 'skipped'
                  ? chalk.gray('○')
                  : node.status === 'waiting'
                    ? chalk.magenta('⏳')
                    : chalk.gray('·')

        const duration = node.durationMs ? chalk.gray(` (${formatDuration(node.durationMs)})`) : ''
        const autoWaitTag = node.autoWait ? chalk.yellow(' [autoWait]') : ''

        console.log(`    ${statusIcon} ${node.name}${duration}${autoWaitTag}`)
        if (node.error) {
          console.log(chalk.red(`        ${node.error}`))
        }
      }
      console.log()
    })

  task
    .command('msg')
    .description('向运行中的任务发送消息')
    .argument('<id>', '任务 ID')
    .argument('<message>', '消息内容')
    .action((id, message) => {
      const task = getTask(id)
      if (!task) {
        error(`Task not found: ${id}`)
        return
      }

      const terminalStatuses = ['completed', 'failed', 'cancelled']
      if (terminalStatuses.includes(task.status)) {
        warn(`Task is already ${task.status}: ${task.title}`)
        return
      }

      const msg = addTaskMessage(id, message, 'cli')
      success(`消息已发送`)
      console.log(chalk.gray(`  Task: ${task.title}`))
      console.log(chalk.gray(`  Message ID: ${msg.id.slice(0, 8)}`))
    })

  task
    .command('inject-node')
    .description('在当前执行节点后动态注入新节点')
    .argument('<id>', '任务 ID')
    .argument('<prompt>', '节点执行内容')
    .option('--persona <name>', '指定 persona', 'Pragmatist')
    .action((id, prompt, options) => {
      const result = injectNode(id, prompt, options.persona)
      if (result.success) {
        success(`节点已注入`)
        console.log(chalk.gray(`  Node ID: ${result.nodeId}`))
        info('新节点将在当前节点完成后执行')
      } else {
        error(result.error || 'Failed to inject node')
      }
    })
}
