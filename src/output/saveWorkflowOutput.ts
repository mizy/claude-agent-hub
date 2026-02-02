/**
 * Save workflow execution output to markdown file
 *
 * Supports two save locations:
 * - Global outputs: outputs/YYYY-MM-DD/TaskTitle_shortId.md
 * - Task folder: data/tasks/{taskId}/outputs/result.md
 */

import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { createLogger } from '../shared/logger.js'
import { formatDuration } from '../shared/formatTime.js'
import { getResultFilePath } from '../store/paths.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance, NodeState } from '../workflow/types.js'

const logger = createLogger('output')

export interface WorkflowExecutionResult {
  task: Task
  workflow: Workflow
  instance: WorkflowInstance
  timing: {
    startedAt: string
    completedAt: string
  }
}

export interface SaveOptions {
  /** Save to task folder instead of global outputs directory */
  toTaskFolder?: boolean
}

/**
 * Sanitize filename: remove invalid chars, limit length
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
    .split('')
    .filter(c => c.charCodeAt(0) > 31) // Remove control chars
    .join('')
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, '') // Trim underscores
    .slice(0, 50) // Limit length
}

/**
 * Get output directory for today: outputs/YYYY-MM-DD
 */
function getGlobalOutputDir(): string {
  const date = new Date().toISOString().slice(0, 10)
  return join(process.cwd(), 'outputs', date)
}

/**
 * Calculate total duration from timing
 */
export function calculateTotalDuration(startedAt: string, completedAt: string): string {
  const start = new Date(startedAt).getTime()
  const end = new Date(completedAt).getTime()
  return formatDuration(end - start)
}

// Re-export formatDuration for backward compatibility
export { formatDuration } from '../shared/formatTime.js'

/**
 * Format node state for markdown
 */
export function formatNodeState(nodeId: string, name: string, state: NodeState, output?: unknown): string {
  const statusEmoji = {
    pending: '⏳',
    ready: '🟡',
    running: '🔵',
    waiting: '👀',
    done: '✅',
    failed: '❌',
    skipped: '⏭️',
  }[state.status] || '❓'

  const lines: string[] = [
    `### ${statusEmoji} ${name}`,
    '',
    `- **Status:** ${state.status}`,
    `- **Attempts:** ${state.attempts}`,
  ]

  if (state.startedAt) {
    lines.push(`- **Started:** ${state.startedAt}`)
  }

  if (state.completedAt) {
    lines.push(`- **Completed:** ${state.completedAt}`)
  }

  if (state.error) {
    lines.push('', '**Error:**', '```', state.error, '```')
  }

  if (output !== undefined) {
    const resultStr = typeof output === 'string'
      ? output
      : JSON.stringify(output, null, 2)

    // Truncate long results
    const truncated = resultStr.length > 2000
      ? resultStr.slice(0, 2000) + '\n... (truncated)'
      : resultStr

    lines.push('', '**Output:**', '```', truncated, '```')
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * Format workflow execution result as markdown
 */
export function formatWorkflowOutput(result: WorkflowExecutionResult): string {
  const { task, workflow, instance, timing } = result

  // Count node states
  const taskNodes = workflow.nodes.filter(n => n.type !== 'start' && n.type !== 'end')
  const completed = taskNodes.filter(n => instance.nodeStates[n.id]?.status === 'done').length
  const failed = taskNodes.filter(n => instance.nodeStates[n.id]?.status === 'failed').length

  const sections: string[] = [
    `# ${task.title}`,
    '',
    '## Summary',
    '',
    `- **Task ID:** ${task.id}`,
    `- **Workflow:** ${workflow.name} (${workflow.id.slice(0, 8)})`,
    `- **Instance:** ${instance.id.slice(0, 8)}`,
    `- **Status:** ${instance.status}`,
    `- **Priority:** ${task.priority}`,
    `- **Started:** ${timing.startedAt}`,
    `- **Completed:** ${timing.completedAt}`,
    `- **Duration:** ${calculateTotalDuration(timing.startedAt, timing.completedAt)}`,
    `- **Progress:** ${completed}/${taskNodes.length} completed, ${failed} failed`,
    '',
    '## Description',
    '',
    task.description || '(No description)',
    '',
    '## Workflow Background',
    '',
    workflow.description || '(No background)',
    '',
    '## Node Execution',
    '',
  ]

  // Add node outputs in order
  for (const node of workflow.nodes) {
    if (node.type === 'start' || node.type === 'end') continue

    const state = instance.nodeStates[node.id]
    if (state) {
      const output = instance.outputs[node.id]
      sections.push(formatNodeState(node.id, node.name, state, output))
    }
  }

  // Add error if workflow failed
  if (instance.error) {
    sections.push(
      '## Workflow Error',
      '',
      '```',
      instance.error,
      '```',
      ''
    )
  }

  return sections.join('\n')
}

/**
 * Get output path based on options
 */
function getOutputPath(result: WorkflowExecutionResult, options: SaveOptions): string {
  if (options.toTaskFolder) {
    return getResultFilePath(result.task.id)
  }

  // Global outputs directory
  const outputDir = getGlobalOutputDir()
  const shortId = result.task.id.slice(0, 8)
  const sanitizedTitle = sanitizeFilename(result.task.title)
  const filename = `${sanitizedTitle}_${shortId}.md`
  return join(outputDir, filename)
}

/**
 * Save workflow execution output to markdown file
 *
 * 注意：此函数从传入的 instance 读取最新状态，确保 result.md 与 instance.json 一致。
 * instance.json 是唯一的执行状态数据源。
 *
 * @param result - Workflow execution result
 * @param options - Save options
 * @param options.toTaskFolder - If true, save to task folder; otherwise save to global outputs
 * @returns The path to the saved file
 */
export async function saveWorkflowOutput(
  result: WorkflowExecutionResult,
  options: SaveOptions = {}
): Promise<string> {
  const outputPath = getOutputPath(result, options)

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true })

  // Format and write content
  const content = formatWorkflowOutput(result)
  await writeFile(outputPath, content, 'utf-8')

  logger.info(`Saved workflow output to ${outputPath}`)
  return outputPath
}

/**
 * 从 instance 重新生成 result.md
 *
 * 用于修复因进程中断导致的 result.md 过时问题。
 * 此函数从 instance.json（唯一数据源）读取最新状态重新生成报告。
 */
export async function regenerateResultFromInstance(
  taskId: string
): Promise<string | null> {
  // 动态导入避免循环依赖
  const { getTask } = await import('../store/TaskStore.js')
  const { getTaskWorkflow, getTaskInstance } = await import('../store/TaskWorkflowStore.js')

  const task = getTask(taskId)
  if (!task) {
    logger.warn(`Task not found: ${taskId}`)
    return null
  }

  const workflow = getTaskWorkflow(taskId)
  const instance = getTaskInstance(taskId)

  if (!workflow || !instance) {
    logger.warn(`Workflow or instance not found for task: ${taskId}`)
    return null
  }

  const timing = {
    startedAt: instance.startedAt || new Date().toISOString(),
    completedAt: instance.completedAt || new Date().toISOString(),
  }

  return saveWorkflowOutput(
    { task, workflow, instance, timing },
    { toTaskFolder: true }
  )
}

