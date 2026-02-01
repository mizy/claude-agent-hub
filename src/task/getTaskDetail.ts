import chalk from 'chalk'
import { existsSync } from 'fs'
import {
  getTask,
  getProcessInfo,
  isProcessRunning,
  getTaskFolder,
} from '../store/TaskStore.js'
import { getWorkflowPath, getInstancePath } from '../store/TaskWorkflowStore.js'
import { getLogPath, getOutputPath } from '../store/TaskLogStore.js'

/**
 * Format status with color
 */
function formatStatus(status: string): string {
  const colors: Record<string, (s: string) => string> = {
    pending: chalk.gray,
    planning: chalk.yellow,
    developing: chalk.blue,
    reviewing: chalk.cyan,
    completed: chalk.green,
    failed: chalk.red,
  }
  return (colors[status] || chalk.white)(status)
}

/**
 * Format process status with color
 */
function formatProcessStatus(status: string, isAlive: boolean): string {
  if (status === 'running') {
    return isAlive ? chalk.green('running') : chalk.red('dead')
  }
  if (status === 'stopped') {
    return chalk.gray('stopped')
  }
  if (status === 'crashed') {
    return chalk.red('crashed')
  }
  return chalk.gray(status)
}

export async function getTaskDetail(id: string): Promise<void> {
  const task = getTask(id)

  if (!task) {
    console.log(chalk.red(`Task "${id}" not found`))
    return
  }

  // Header
  console.log(chalk.bold(`Task: ${task.title}`))
  console.log(chalk.gray('─'.repeat(60)))

  // Basic info
  console.log(`${chalk.gray('ID:')}       ${task.id}`)
  console.log(`${chalk.gray('Status:')}   ${formatStatus(task.status)}`)
  console.log(`${chalk.gray('Priority:')} ${task.priority}`)
  console.log(`${chalk.gray('Assignee:')} ${task.assignee || chalk.gray('(not assigned)')}`)
  console.log(`${chalk.gray('Created:')}  ${task.createdAt}`)

  // Process info
  const processInfo = getProcessInfo(task.id)
  if (processInfo) {
    console.log('')
    console.log(chalk.bold('Process:'))
    const isAlive = processInfo.status === 'running' && isProcessRunning(processInfo.pid)
    console.log(`  ${chalk.gray('PID:')}    ${processInfo.pid}`)
    console.log(`  ${chalk.gray('Status:')} ${formatProcessStatus(processInfo.status, isAlive)}`)
    console.log(`  ${chalk.gray('Started:')} ${processInfo.startedAt}`)
    if (processInfo.lastHeartbeat) {
      console.log(`  ${chalk.gray('Last heartbeat:')} ${processInfo.lastHeartbeat}`)
    }
    if (processInfo.error) {
      console.log(`  ${chalk.gray('Error:')} ${chalk.red(processInfo.error)}`)
    }
  }

  // Description
  if (task.description) {
    console.log('')
    console.log(chalk.bold('Description:'))
    console.log(task.description)
  }

  // File paths
  const taskFolder = getTaskFolder(task.id)
  if (taskFolder && existsSync(taskFolder)) {
    console.log('')
    console.log(chalk.bold('Files:'))
    console.log(`  ${chalk.gray('Folder:')} ${taskFolder}`)

    const workflowPath = getWorkflowPath(task.id)
    if (existsSync(workflowPath)) {
      console.log(`  ${chalk.gray('Workflow:')} ${workflowPath}`)
    }

    const instancePath = getInstancePath(task.id)
    if (existsSync(instancePath)) {
      console.log(`  ${chalk.gray('Instance:')} ${instancePath}`)
    }

    const logPath = getLogPath(task.id)
    if (existsSync(logPath)) {
      console.log(`  ${chalk.gray('Log:')} ${logPath}`)
    }

    const outputPath = getOutputPath(task.id)
    if (existsSync(outputPath)) {
      console.log(`  ${chalk.gray('Output:')} ${chalk.green(outputPath)}`)
    }
  }

  // Branch info (legacy)
  if (task.branch) {
    console.log('')
    console.log(`${chalk.gray('Branch:')} ${task.branch}`)
  }
}
