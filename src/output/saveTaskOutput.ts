/**
 * Save task execution output to markdown file
 * Output path: outputs/YYYY-MM-DD/TaskTitle_shortId.md
 */

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { createLogger } from '../shared/logger.js'
import type { TaskExecutionResult, StepOutput } from '../types/output.js'

const logger = createLogger('output')

/**
 * Sanitize filename: remove invalid chars, limit length
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // Remove invalid chars
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, '') // Trim underscores
    .slice(0, 50) // Limit length
}

/**
 * Get output directory for today: outputs/YYYY-MM-DD
 */
function getOutputDir(): string {
  const date = new Date().toISOString().slice(0, 10)
  return join(process.cwd(), 'outputs', date)
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
 * Format step output for markdown
 */
function formatStepOutput(step: StepOutput): string {
  const lines: string[] = [
    `### Step ${step.stepOrder}: ${step.action}`,
    '',
    `**Files:** ${step.files.join(', ') || '(none)'}`,
    `**Duration:** ${formatDuration(step.durationMs)}`,
    '',
    '```',
    step.output.trim(),
    '```',
    '',
  ]
  return lines.join('\n')
}

/**
 * Format task execution result as markdown
 */
function formatTaskOutput(result: TaskExecutionResult): string {
  const { task, agent, branch, plan, stepOutputs, timing } = result

  const sections: string[] = [
    `# ${task.title}`,
    '',
    '## Task Info',
    '',
    `- **Task ID:** ${task.id}`,
    `- **Agent:** ${agent.name} (${agent.persona})`,
    `- **Branch:** ${branch}`,
    `- **Priority:** ${task.priority}`,
    `- **Started:** ${timing.startedAt}`,
    `- **Completed:** ${timing.completedAt}`,
    `- **Duration:** ${calculateTotalDuration(timing.startedAt, timing.completedAt)}`,
    '',
    '## Description',
    '',
    task.description || '(No description)',
    '',
    '## Execution Plan',
    '',
    `**Analysis:** ${plan.analysis}`,
    '',
    `**Estimated Effort:** ${plan.estimatedEffort}`,
    '',
    `**Risks:**`,
    ...plan.risks.map(r => `- ${r}`),
    '',
    '**Steps:**',
    ...plan.steps.map(s => `${s.order}. ${s.action} (${s.files.join(', ')})`),
    '',
    '## Execution Output',
    '',
    ...stepOutputs.map(formatStepOutput),
  ]

  return sections.join('\n')
}

/**
 * Save task execution output to markdown file
 * @returns The path to the saved file
 */
export async function saveTaskOutput(result: TaskExecutionResult): Promise<string> {
  const outputDir = getOutputDir()

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true })

  // Generate filename: TaskTitle_shortId.md
  const shortId = result.task.id.slice(0, 8)
  const sanitizedTitle = sanitizeFilename(result.task.title)
  const filename = `${sanitizedTitle}_${shortId}.md`
  const outputPath = join(outputDir, filename)

  // Format and write content
  const content = formatTaskOutput(result)
  await writeFile(outputPath, content, 'utf-8')

  logger.info(`Saved output to ${outputPath}`)
  return outputPath
}
