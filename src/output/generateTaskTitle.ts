/**
 * Generate task title using Claude Code
 * Called when task.title is generic (e.g., "New Task", "Task 1")
 */

import { invokeClaudeCode } from '../claude/invokeClaudeCode.js'
import { buildGenerateTitleFromWorkflowPrompt } from '../prompts/index.js'
import { loadConfig } from '../config/loadConfig.js'
import { createLogger } from '../shared/logger.js'
import type { Task } from '../types/task.js'
import type { Workflow } from '../workflow/types.js'

const logger = createLogger('output')

// Patterns that indicate generic/placeholder titles
const GENERIC_PATTERNS = [
  /^(new\s+)?task\s*\d*$/i,
  /^(新)?任务\s*\d*$/i,
  /^todo\s*\d*$/i,
  /^untitled$/i,
  /^无标题$/i,
  /^test\s*\d*$/i,
  /^测试\s*\d*$/i,
]

/**
 * Check if a title is generic/placeholder
 */
export function isGenericTitle(title: string): boolean {
  const trimmed = title.trim()
  if (!trimmed || trimmed.length < 3) return true
  return GENERIC_PATTERNS.some(pattern => pattern.test(trimmed))
}

/**
 * Generate a descriptive task title from workflow using Claude Code
 * Falls back to original title on error
 */
export async function generateTaskTitle(task: Task, workflow: Workflow): Promise<string> {
  const prompt = buildGenerateTitleFromWorkflowPrompt(task, workflow)
  const config = await loadConfig()
  const model = config.claude?.model || 'opus'

  const result = await invokeClaudeCode({
    prompt,
    mode: 'plan',
    model,
  })

  if (!result.ok) {
    logger.debug('Failed to generate title, using original', result.error)
    return task.title
  }

  // Clean the result: remove quotes, trim, limit length
  const title = result.value.response
    .trim()
    .replace(/^["'`]|["'`]$/g, '') // Remove surrounding quotes
    .replace(/\n.*/s, '') // Take only first line
    .slice(0, 50)
    .trim()

  if (title && title.length >= 3) {
    logger.info(`Generated title: "${title}"`)
    return title
  }

  return task.title
}
