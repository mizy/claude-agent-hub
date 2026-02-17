/**
 * Analyze failed tasks to determine if the failure is prompt-related.
 *
 * Uses LLM to classify failure root cause and suggest improvements.
 */

import { invokeBackend } from '../backend/index.js'
import { createLogger } from '../shared/logger.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'
import type { FailureAnalysis, FailedNodeInfo } from '../types/promptVersion.js'

const logger = createLogger('prompt-optimization')

type RootCauseCategory = 'prompt_unclear' | 'tool_error' | 'context_insufficient' | 'other'

interface LLMAnalysisResult {
  category: RootCauseCategory
  rootCause: string
  suggestion: string
  isPromptRelated: boolean
}

/** Extract failed node info from workflow instance */
export function extractFailedNodes(
  workflow: Workflow,
  instance: WorkflowInstance
): FailedNodeInfo[] {
  const failed: FailedNodeInfo[] = []
  for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
    if (state.status !== 'failed') continue
    const node = workflow.nodes.find(n => n.id === nodeId)
    failed.push({
      nodeId,
      nodeName: node?.name ?? nodeId,
      error: state.error ?? 'Unknown error',
      attempts: state.attempts,
    })
  }
  return failed
}

/** Build the analysis prompt for LLM */
function buildAnalysisPrompt(
  task: Task,
  workflow: Workflow,
  failedNodes: FailedNodeInfo[]
): string {
  const nodeDetails = failedNodes
    .map(
      n =>
        `- Node "${n.nodeName}" (${n.nodeId}): failed after ${n.attempts} attempt(s)\n  Error: ${n.error}`
    )
    .join('\n')

  return `You are analyzing a failed AI task execution to determine the root cause.

## Task
Title: ${task.title}
Description: ${task.description}

## Workflow
Name: ${workflow.name}
Description: ${workflow.description}

## Failed Nodes
${nodeDetails}

## Instructions
Analyze the failure and respond in this EXACT JSON format (no markdown, no code fences):
{
  "category": "<one of: prompt_unclear, tool_error, context_insufficient, other>",
  "rootCause": "<1-2 sentence description of why it failed>",
  "suggestion": "<1-2 sentence suggestion for fixing the prompt>",
  "isPromptRelated": <true if the failure could be improved by changing the prompt, false if it's an external issue like network error or tool unavailability>
}

Categories:
- prompt_unclear: The prompt was ambiguous or misleading, causing the AI to misunderstand the task
- tool_error: A tool/command failed (e.g., build error, test failure, file not found)
- context_insufficient: The prompt lacked necessary context (e.g., missing file paths, unclear project structure)
- other: External factors (network, timeout, permissions, etc.)

Only set isPromptRelated=true if changing the prompt text could realistically prevent this failure.`
}

/** Parse the LLM's JSON response */
function parseAnalysisResponse(response: string): LLMAnalysisResult | null {
  try {
    // Try to extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])

    const validCategories: RootCauseCategory[] = [
      'prompt_unclear',
      'tool_error',
      'context_insufficient',
      'other',
    ]
    if (!validCategories.includes(parsed.category)) {
      parsed.category = 'other'
    }

    return {
      category: parsed.category,
      rootCause: String(parsed.rootCause ?? ''),
      suggestion: String(parsed.suggestion ?? ''),
      isPromptRelated: Boolean(parsed.isPromptRelated),
    }
  } catch {
    logger.warn('Failed to parse LLM analysis response')
    return null
  }
}

/**
 * Analyze a failed task to determine if the failure is prompt-related.
 *
 * Returns FailureAnalysis if the failure is prompt-related, null otherwise
 * (e.g., network errors, tool unavailability).
 */
export async function analyzeFailure(
  task: Task,
  workflow: Workflow,
  instance: WorkflowInstance,
  versionId: string
): Promise<FailureAnalysis | null> {
  const failedNodes = extractFailedNodes(workflow, instance)
  if (failedNodes.length === 0) {
    logger.debug(`Task ${task.id}: no failed nodes found, skipping analysis`)
    return null
  }

  // Find the persona used (from first task node)
  const taskNode = workflow.nodes.find(n => n.type === 'task' && n.task?.persona)
  const personaName = taskNode?.task?.persona ?? 'Pragmatist'

  const prompt = buildAnalysisPrompt(task, workflow, failedNodes)

  logger.info(`Analyzing failure for task ${task.id} (${failedNodes.length} failed nodes)`)

  const result = await invokeBackend({
    prompt,
    model: 'haiku',
  })

  if (!result.ok) {
    logger.warn(`Failed to invoke backend for failure analysis: ${result.error.message}`)
    return null
  }

  const analysis = parseAnalysisResponse(result.value.response)
  if (!analysis) {
    logger.warn(`Failed to parse failure analysis response for task ${task.id}`)
    return null
  }

  // Only return analysis if the failure is prompt-related
  if (!analysis.isPromptRelated) {
    logger.debug(
      `Task ${task.id}: failure is not prompt-related (category: ${analysis.category})`
    )
    return null
  }

  return {
    taskId: task.id,
    personaName,
    versionId,
    failedNodes,
    rootCause: `[${analysis.category}] ${analysis.rootCause}`,
    suggestion: analysis.suggestion,
    analyzedAt: new Date().toISOString(),
  }
}
