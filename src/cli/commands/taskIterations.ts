/**
 * CLI: task iterations sub-command
 */

import type { Command } from 'commander'
import chalk from 'chalk'
import { listIterations, getIteration } from '../../store/IterationStore.js'
import { getTask } from '../../store/TaskStore.js'
import { formatDuration } from '../../shared/formatTime.js'
import { error, warn, info } from '../output.js'

export interface IterationsOptions {
  last?: string
  detail?: string
  json?: boolean
}

/**
 * Handle iterations action — shared between `cah task iterations` and `cah iterations` shortcut
 */
export function handleIterationsAction(id: string, options: IterationsOptions): void {
  const foundTask = getTask(id)
  if (!foundTask) {
    error(`Task "${id}" not found`)
    return
  }

  // Detail mode: show single iteration
  if (options.detail) {
    const iterNum = parseInt(options.detail, 10)
    const record = getIteration(id, iterNum)
    if (!record) {
      warn(`Iteration #${iterNum} not found for task: ${id}`)
      return
    }

    if (options.json) {
      console.log(JSON.stringify(record, null, 2))
      return
    }

    console.log(chalk.bold(`\nIteration #${String(record.iterationNumber).padStart(3, '0')}`))
    console.log(chalk.gray('─'.repeat(60)))
    console.log(`${chalk.gray('Status:')}    ${formatIterationStatus(record.status)}`)
    console.log(`${chalk.gray('Started:')}   ${record.startedAt}`)
    console.log(`${chalk.gray('Completed:')} ${record.completedAt}`)
    console.log(
      `${chalk.gray('Duration:')}  ${record.durationMs > 0 ? formatDuration(record.durationMs) : '-'}`
    )
    if (record.error) {
      console.log(`${chalk.gray('Error:')}     ${chalk.red(record.error)}`)
    }

    // Node outputs
    const nodeIds = Object.keys(record.outputs)
    if (nodeIds.length > 0) {
      console.log('')
      console.log(chalk.bold('Node Outputs:'))
      for (const nodeId of nodeIds) {
        const output = record.outputs[nodeId]
        console.log(`  ${chalk.cyan(nodeId)}:`)
        if (output) {
          const lines = output.split('\n')
          for (const line of lines) {
            console.log(`    ${line}`)
          }
        }
      }
    }
    console.log()
    return
  }

  // List mode
  let records = listIterations(id)
  if (records.length === 0) {
    warn(`No iteration records for task: ${id}`)
    info('Iteration records are created when scheduled tasks loop back')
    return
  }

  if (options.last) {
    const n = parseInt(options.last, 10)
    records = records.slice(-n)
  }

  if (options.json) {
    console.log(JSON.stringify(records, null, 2))
    return
  }

  console.log(chalk.bold(`\nIterations for task: ${foundTask.title || id}`))
  console.log(chalk.gray('─'.repeat(60)))

  // Table header
  console.log(
    '  ' +
      [
        chalk.bold('#'.padEnd(6)),
        chalk.bold('Started'.padEnd(18)),
        chalk.bold('Duration'.padEnd(12)),
        chalk.bold('Status'.padEnd(12)),
      ].join('')
  )
  console.log('  ' + chalk.dim('─'.repeat(48)))

  // Table rows
  for (const record of records) {
    const num = `#${String(record.iterationNumber).padStart(3, '0')}`.padEnd(6)
    const started = formatShortTime(record.startedAt).padEnd(18)
    const duration = (
      record.durationMs > 0 ? formatDuration(record.durationMs) : '-'
    ).padEnd(12)
    const status = formatIterationStatus(record.status)

    console.log(`  ${num}${started}${duration}${status}`)
  }

  console.log(chalk.gray(`\n  Total: ${records.length} iterations`))
  console.log(chalk.gray(`  Use --detail <n> to view iteration details\n`))
}

export function registerTaskIterationsCommands(task: Command) {
  task
    .command('iterations')
    .alias('iter')
    .description('查看定时任务迭代记录')
    .argument('<id>', '任务 ID')
    .option('--last <n>', '只显示最近 N 条记录')
    .option('--detail <n>', '显示第 N 次迭代的详细输出')
    .option('--json', '以 JSON 格式输出')
    .action(handleIterationsAction)
}

function formatIterationStatus(status: string): string {
  if (status === 'completed') return chalk.green('completed')
  if (status === 'failed') return chalk.red('failed')
  return chalk.gray(status)
}

function formatShortTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${month}-${day} ${hours}:${minutes}`
  } catch {
    return isoString.slice(0, 16)
  }
}
