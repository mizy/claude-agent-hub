/**
 * Save workflow execution output to task folder
 * Output path: data/tasks/{taskId}/outputs/result.md
 */

import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { createLogger } from '../shared/logger.js'
import { getOutputPath } from '../store/TaskStore.js'
import type { Task } from '../types/task.js'
import type { Agent } from '../types/agent.js'
import type { Workflow, WorkflowInstance, NodeState } from '../workflow/types.js'

const logger = createLogger('output')

export interface WorkflowExecutionResult {
  task: Task
  agent: Agent
  workflow: Workflow
  instance: WorkflowInstance
  timing: {
    startedAt: string
    completedAt: string
  }
}

/**
 * Format duration from milliseconds to human readable
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${seconds}s`
}

/**
 * Calculate total duration from timing
 */
function calculateTotalDuration(startedAt: string, completedAt: string): string {
  const start = new Date(startedAt).getTime()
  const end = new Date(completedAt).getTime()
  return formatDuration(end - start)
}

/**
 * Format node state for markdown
 */
function formatNodeState(nodeId: string, name: string, state: NodeState): string {
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

  if (state.result) {
    const resultStr = typeof state.result === 'string'
      ? state.result
      : JSON.stringify(state.result, null, 2)

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
function formatWorkflowOutput(result: WorkflowExecutionResult): string {
  const { task, agent, workflow, instance, timing } = result

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
    `- **Agent:** ${agent.name} (${agent.persona})`,
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
      sections.push(formatNodeState(node.id, node.name, state))
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
 * Save workflow execution output to task folder
 * @returns The path to the saved file
 */
export async function saveWorkflowOutputToTask(result: WorkflowExecutionResult): Promise<string> {
  const outputPath = getOutputPath(result.task.id)

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true })

  // Format and write content
  const content = formatWorkflowOutput(result)
  await writeFile(outputPath, content, 'utf-8')

  logger.info(`Saved workflow output to ${outputPath}`)
  return outputPath
}
