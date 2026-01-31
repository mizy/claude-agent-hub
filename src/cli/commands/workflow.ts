/**
 * Workflow CLI 命令
 */

import { Command } from 'commander'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import chalk from 'chalk'
import { table } from 'table'
import {
  parseMarkdown,
  validateMarkdown,
  saveWorkflow,
  getWorkflow,
  getAllWorkflows,
  getAllInstances,
  getInstancesByStatus,
  startWorkflow,
  approveHumanNode,
  rejectHumanNode,
  pauseWorkflowInstance,
  resumeWorkflowInstance,
  cancelWorkflowInstance,
  getWorkflowProgress,
} from '../../workflow/index.js'
import { success, error, info } from '../output.js'
import { withSpinner } from '../spinner.js'
import { shortenId } from '../../shared/id.js'

export function createWorkflowCommand(): Command {
  const cmd = new Command('workflow').description('工作流管理')

  // 列出工作流
  cmd
    .command('list')
    .alias('ls')
    .description('列出所有工作流')
    .action(listWorkflows)

  // 查看工作流状态
  cmd
    .command('status <id>')
    .description('查看工作流详情')
    .action(showWorkflowStatus)

  // 从文件创建工作流
  cmd
    .command('create')
    .description('从 Markdown 文件创建工作流')
    .option('-f, --file <path>', 'Markdown 文件路径')
    .option('--start', '创建后立即启动', false)
    .action(createWorkflowFromFile)

  // 启动工作流
  cmd
    .command('start <id>')
    .description('启动工作流')
    .action(startWorkflowCommand)

  // 暂停工作流
  cmd
    .command('pause <id>')
    .description('暂停工作流')
    .action(pauseWorkflowCommand)

  // 恢复工作流
  cmd
    .command('resume <id>')
    .description('恢复工作流')
    .action(resumeWorkflowCommand)

  // 取消工作流
  cmd
    .command('cancel <id>')
    .description('取消工作流')
    .action(cancelWorkflowCommand)

  // 审批通过
  cmd
    .command('approve <workflow-id> <node-id>')
    .description('审批通过')
    .action(approveNodeCommand)

  // 审批驳回
  cmd
    .command('reject <workflow-id> <node-id>')
    .option('-r, --reason <reason>', '驳回原因')
    .description('审批驳回')
    .action(rejectNodeCommand)

  // 待审批列表
  cmd
    .command('pending')
    .description('查看待审批节点')
    .action(listPendingNodes)

  return cmd
}

// ============ 命令实现 ============

async function listWorkflows(): Promise<void> {
  const workflows = getAllWorkflows()

  if (workflows.length === 0) {
    info('No workflows found')
    return
  }

  const data: string[][] = [
    ['ID', 'Name', 'Nodes', 'Created'],
  ]

  for (const wf of workflows) {
    const taskNodes = wf.nodes.filter(n => n.type !== 'start' && n.type !== 'end')
    data.push([
      shortenId(wf.id),
      wf.name,
      String(taskNodes.length),
      new Date(wf.createdAt).toLocaleDateString(),
    ])
  }

  console.log(table(data))
}

async function showWorkflowStatus(id: string): Promise<void> {
  const workflow = getWorkflow(id)
  if (!workflow) {
    error(`Workflow not found: ${id}`)
    return
  }

  console.log(chalk.bold(`\nWorkflow: ${workflow.name}`))
  console.log(chalk.gray(`ID: ${workflow.id}`))
  console.log(chalk.gray(`Description: ${workflow.description || '-'}`))
  console.log()

  // 获取实例
  const instances = getAllInstances().filter(i => i.workflowId === workflow.id)
  const latest = instances[0]

  if (!latest) {
    info('No instances')
    return
  }

  const progress = getWorkflowProgress(latest, workflow)

  console.log(chalk.bold('Latest Instance:'))
  console.log(`  Status: ${formatStatus(latest.status)}`)
  console.log(`  Progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`)

  if (latest.startedAt) {
    console.log(`  Started: ${new Date(latest.startedAt).toLocaleString()}`)
  }

  console.log()
  console.log(chalk.bold('Nodes:'))

  for (const node of workflow.nodes) {
    if (node.type === 'start' || node.type === 'end') continue

    const state = latest.nodeStates[node.id]
    const statusIcon = getStatusIcon(state?.status || 'pending')
    const agentInfo = node.task?.agent ? chalk.gray(` (${node.task.agent})`) : ''

    console.log(`  ${statusIcon} ${node.name}${agentInfo}`)

    if (state?.error) {
      console.log(chalk.red(`      Error: ${state.error}`))
    }
  }
}

async function createWorkflowFromFile(options: {
  file?: string
  start?: boolean
}): Promise<void> {
  if (!options.file) {
    error('Please specify a file with --file')
    return
  }

  if (!existsSync(options.file)) {
    error(`File not found: ${options.file}`)
    return
  }

  const content = await readFile(options.file, 'utf-8')

  // 验证格式
  const validation = validateMarkdown(content)
  if (!validation.valid) {
    error('Invalid markdown format:')
    for (const err of validation.errors) {
      console.log(chalk.red(`  - ${err}`))
    }
    return
  }

  // 解析并保存
  const workflow = await withSpinner(
    'Parsing workflow...',
    async () => {
      const wf = parseMarkdown(content, options.file)
      saveWorkflow(wf)
      return wf
    }
  )

  success(`Created workflow: ${workflow.name}`)
  console.log(chalk.gray(`  ID: ${workflow.id}`))
  console.log(chalk.gray(`  Nodes: ${workflow.nodes.length - 2} tasks`))

  // 自动启动
  if (options.start) {
    await startWorkflowCommand(workflow.id)
  }
}

async function startWorkflowCommand(id: string): Promise<void> {
  const workflow = getWorkflow(id)
  if (!workflow) {
    error(`Workflow not found: ${id}`)
    return
  }

  const instance = await withSpinner(
    'Starting workflow...',
    () => startWorkflow(id)
  )

  success(`Workflow started`)
  console.log(chalk.gray(`  Instance: ${instance.id}`))
}

async function pauseWorkflowCommand(id: string): Promise<void> {
  // 找到运行中的实例
  const instances = getInstancesByStatus('running')
  const instance = instances.find(i => i.workflowId.startsWith(id) || i.id.startsWith(id))

  if (!instance) {
    error(`No running instance found for: ${id}`)
    return
  }

  await pauseWorkflowInstance(instance.id)
  success('Workflow paused')
}

async function resumeWorkflowCommand(id: string): Promise<void> {
  const instances = getInstancesByStatus('paused')
  const instance = instances.find(i => i.workflowId.startsWith(id) || i.id.startsWith(id))

  if (!instance) {
    error(`No paused instance found for: ${id}`)
    return
  }

  await resumeWorkflowInstance(instance.id)
  success('Workflow resumed')
}

async function cancelWorkflowCommand(id: string): Promise<void> {
  const instances = getAllInstances()
  const instance = instances.find(
    i => (i.workflowId.startsWith(id) || i.id.startsWith(id)) &&
         (i.status === 'running' || i.status === 'paused')
  )

  if (!instance) {
    error(`No active instance found for: ${id}`)
    return
  }

  await cancelWorkflowInstance(instance.id)
  success('Workflow cancelled')
}

async function approveNodeCommand(workflowId: string, nodeId: string): Promise<void> {
  try {
    // 找到实例
    const instances = getAllInstances()
    const instance = instances.find(
      i => i.workflowId.startsWith(workflowId) && i.status === 'running'
    )

    if (!instance) {
      error(`No running instance found for workflow: ${workflowId}`)
      return
    }

    await approveHumanNode(instance.workflowId, instance.id, nodeId)
    success(`Node approved: ${nodeId}`)
  } catch (err) {
    error(err instanceof Error ? err.message : String(err))
  }
}

async function rejectNodeCommand(
  workflowId: string,
  nodeId: string,
  options: { reason?: string }
): Promise<void> {
  try {
    const instances = getAllInstances()
    const instance = instances.find(
      i => i.workflowId.startsWith(workflowId) && i.status === 'running'
    )

    if (!instance) {
      error(`No running instance found for workflow: ${workflowId}`)
      return
    }

    await rejectHumanNode(instance.workflowId, instance.id, nodeId, options.reason)
    success(`Node rejected: ${nodeId}`)
  } catch (err) {
    error(err instanceof Error ? err.message : String(err))
  }
}

async function listPendingNodes(): Promise<void> {
  const instances = getInstancesByStatus('running')

  const pendingNodes: Array<{
    workflowId: string
    workflowName: string
    instanceId: string
    nodeId: string
    nodeName: string
  }> = []

  for (const instance of instances) {
    const workflow = getWorkflow(instance.workflowId)
    if (!workflow) continue

    for (const node of workflow.nodes) {
      if (node.type !== 'human') continue

      const state = instance.nodeStates[node.id]
      if (state?.status === 'running') {
        pendingNodes.push({
          workflowId: shortenId(instance.workflowId),
          workflowName: workflow.name,
          instanceId: shortenId(instance.id),
          nodeId: node.id,
          nodeName: node.name,
        })
      }
    }
  }

  if (pendingNodes.length === 0) {
    info('No pending approvals')
    return
  }

  const data: string[][] = [
    ['Workflow', 'Instance', 'Node', 'Name'],
  ]

  for (const item of pendingNodes) {
    data.push([
      item.workflowId,
      item.instanceId,
      item.nodeId,
      item.nodeName,
    ])
  }

  console.log(table(data))
}

// ============ 辅助函数 ============

function formatStatus(status: string): string {
  const colors: Record<string, (s: string) => string> = {
    pending: chalk.gray,
    running: chalk.blue,
    paused: chalk.yellow,
    completed: chalk.green,
    failed: chalk.red,
    cancelled: chalk.gray,
  }
  return (colors[status] || chalk.white)(status)
}

function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    pending: chalk.gray('○'),
    ready: chalk.blue('◉'),
    running: chalk.blue('◐'),
    done: chalk.green('✓'),
    failed: chalk.red('✗'),
    skipped: chalk.gray('⊘'),
  }
  return icons[status] || '?'
}
