/**
 * CLI: task logs + stats sub-commands
 */

import type { Command } from 'commander'
import chalk from 'chalk'
import { writeFileSync } from 'fs'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import {
  getTaskFolder,
  getLogPath,
  getExecutionStats,
  getExecutionTimeline,
  formatExecutionSummary,
  formatTimeline,
} from '../../task/index.js'
import {
  generateExecutionReport,
  formatReportForTerminal,
  formatReportForMarkdown,
} from '../../report/ExecutionReport.js'
import { success, error, info, warn } from '../output.js'
import { AppError } from '../../shared/error.js'
import { formatDuration } from '../../shared/formatTime.js'

export function registerTaskLogsCommands(task: Command) {
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
        console.error(AppError.taskNotFound(id).format())
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
        const statusIcon =
          node.status === 'completed'
            ? '✓'
            : node.status === 'failed'
              ? '✗'
              : node.status === 'skipped'
                ? '○'
                : '•'
        const statusColor =
          node.status === 'completed'
            ? chalk.green
            : node.status === 'failed'
              ? chalk.red
              : node.status === 'skipped'
                ? chalk.gray
                : chalk.yellow

        const duration = node.durationMs ? ` (${formatDuration(node.durationMs)})` : ''
        const cost = node.costUsd ? ` $${node.costUsd.toFixed(4)}` : ''

        console.log(
          statusColor(`  ${statusIcon} ${node.nodeName} [${node.nodeType}]${duration}${cost}`)
        )
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
    .option('-n, --tail <n>', '显示最后 N 行', '50')
    .option('--head <n>', '显示前 N 行')
    .action((id, options) => {
      const taskFolder = getTaskFolder(id)
      if (!taskFolder) {
        console.error(AppError.taskNotFound(id).format())
        return
      }

      const logPath = getLogPath(id)
      if (!existsSync(logPath)) {
        warn(`No logs yet for task: ${id}`)
        console.log(chalk.gray(`  Log path: ${logPath}`))
        return
      }

      info(`Viewing logs for task: ${id}`)
      console.log(chalk.gray(`  Path: ${logPath}`))
      if (options.follow) {
        console.log(chalk.gray(`  Press Ctrl+C to stop\n`))
      }

      // 使用 head 或 tail 命令
      if (options.head) {
        const head = spawn('head', ['-n', options.head, logPath], {
          stdio: 'inherit',
        })
        head.on('error', err => {
          error(`Failed to read logs: ${err.message}`)
        })
      } else {
        const tailArgs = ['-n', options.tail]
        if (options.follow) {
          tailArgs.push('-f')
        }
        tailArgs.push(logPath)

        const tail = spawn('tail', tailArgs, {
          stdio: 'inherit',
        })

        tail.on('error', err => {
          error(`Failed to tail logs: ${err.message}`)
        })
      }
    })
}
