/**
 * Save workflow execution output to markdown file
 *
 * Output location: tasks/{taskId}/outputs/result.md
 */

import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { createLogger } from '../shared/logger.js'
import { formatDuration } from '../shared/formatTime.js'
import { getResultFilePath } from '../store/paths.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance, NodeState } from '../workflow/types.js'

const logger = createLogger('output')

const MAX_NODE_OUTPUT_LENGTH = 10000

export interface WorkflowExecutionResult {
  task: Task
  workflow: Workflow
  instance: WorkflowInstance
  timing: {
    startedAt: string
    completedAt: string
  }
}

/**
 * Calculate total duration from timing
 */
export function calculateTotalDuration(startedAt: string, completedAt: string): string {
  const start = new Date(startedAt).getTime()
  const end = new Date(completedAt).getTime()
  return formatDuration(end - start)
}

/**
 * Format node state for markdown
 */
export function formatNodeState(
  nodeId: string,
  name: string,
  state: NodeState,
  output?: unknown
): string {
  const statusEmoji =
    {
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
    // 优先使用 _raw 字段（节点输出的原始文本），避免输出整个 JSON 结构
    const resultStr =
      typeof output === 'string'
        ? output
        : output &&
            typeof output === 'object' &&
            '_raw' in output &&
            typeof (output as Record<string, unknown>)._raw === 'string'
          ? ((output as Record<string, unknown>)._raw as string)
          : JSON.stringify(output, null, 2)

    // Truncate long results
    const truncated =
      resultStr.length > MAX_NODE_OUTPUT_LENGTH
        ? resultStr.slice(0, MAX_NODE_OUTPUT_LENGTH) + '\n\n... (truncated)'
        : resultStr

    // 检测是否是 markdown 内容（包含标题、列表、代码块等）
    const isMarkdown =
      /^#{1,6}\s/m.test(truncated) || /^[-*]\s/m.test(truncated) || /```/.test(truncated)

    if (isMarkdown) {
      // Markdown 内容直接输出，不包裹代码块
      lines.push('', '**Output:**', '', truncated)
    } else {
      // 非 markdown 内容（如 JSON）用代码块包裹
      lines.push('', '**Output:**', '```', truncated, '```')
    }
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
    sections.push('## Workflow Error', '', '```', instance.error, '```', '')
  }

  return sections.join('\n')
}

/**
 * Get output path: tasks/{taskId}/outputs/result.md
 */
function getOutputPath(result: WorkflowExecutionResult): string {
  return getResultFilePath(result.task.id)
}

/**
 * Save workflow execution output to markdown file
 *
 * 注意：此函数从传入的 instance 读取最新状态，确保 result.md 与 instance.json 一致。
 * instance.json 是唯一的执行状态数据源。
 *
 * @param result - Workflow execution result
 * @returns The path to the saved file
 */
export async function saveWorkflowOutput(result: WorkflowExecutionResult): Promise<string> {
  const outputPath = getOutputPath(result)

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true })

  // Format and write content
  const content = formatWorkflowOutput(result)
  await writeFile(outputPath, content, 'utf-8')

  logger.info(`Saved workflow output to ${outputPath}`)
  return outputPath
}
