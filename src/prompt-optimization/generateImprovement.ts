/**
 * Generate an improved prompt version based on failure analysis.
 *
 * Uses the "textual gradient" approach: identify problematic prompt fragments,
 * generate targeted improvements while preserving overall structure.
 */

import { invokeBackend } from '../backend/index.js'
import {
  generateVersionId,
  savePromptVersion,
  getLatestVersion,
} from '../store/PromptVersionStore.js'
import { createLogger } from '../shared/logger.js'
import type { PromptVersion, FailureAnalysis } from '../types/promptVersion.js'

const logger = createLogger('prompt-optimization')

/** Build the improvement prompt for LLM */
function buildImprovementPrompt(
  currentVersion: PromptVersion,
  recentFailures: FailureAnalysis[]
): string {
  const failureSummary = recentFailures
    .map(
      (f, i) =>
        `${i + 1}. Task ${f.taskId}:\n   Root cause: ${f.rootCause}\n   Suggestion: ${f.suggestion}\n   Failed nodes: ${f.failedNodes.map(n => `${n.nodeName}: ${n.error}`).join('; ')}`
    )
    .join('\n')

  return `You are an AI prompt engineer. Your job is to improve a system prompt based on observed failures.

## Current System Prompt (v${currentVersion.version})
---
${currentVersion.systemPrompt}
---

## Recent Failures Using This Prompt
${failureSummary}

## Current Stats
- Success rate: ${(currentVersion.stats.successRate * 100).toFixed(0)}%
- Total tasks: ${currentVersion.stats.totalTasks}
- Failures: ${currentVersion.stats.failureCount}

## Instructions
Analyze the failure patterns and generate an improved version of the system prompt.

Rules:
1. Keep the overall structure and tone of the prompt
2. Only modify sections that are related to the observed failures
3. Be specific and actionable in your improvements
4. Do NOT add generic boilerplate — only add what addresses the actual failures
5. Keep the prompt concise — do not make it significantly longer

Respond in this EXACT JSON format (no markdown, no code fences):
{
  "improvedPrompt": "<the full improved system prompt>",
  "changelog": "<1-2 sentence description of what changed and why>"
}`
}

/** Parse the LLM's improvement response */
function parseImprovementResponse(
  response: string
): { improvedPrompt: string; changelog: string } | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.improvedPrompt || !parsed.changelog) return null
    return {
      improvedPrompt: String(parsed.improvedPrompt),
      changelog: String(parsed.changelog),
    }
  } catch {
    logger.warn('Failed to parse LLM improvement response')
    return null
  }
}

/**
 * Generate an improved prompt version based on failure analysis.
 *
 * Creates a new 'candidate' version that will be validated before promotion.
 * Returns the new version, or null if improvement generation fails.
 */
export async function generateImprovement(
  currentVersion: PromptVersion,
  recentFailures: FailureAnalysis[]
): Promise<PromptVersion | null> {
  if (recentFailures.length === 0) {
    logger.debug('No failures provided, skipping improvement generation')
    return null
  }

  const prompt = buildImprovementPrompt(currentVersion, recentFailures)

  logger.info(
    `Generating prompt improvement for ${currentVersion.personaName} v${currentVersion.version} ` +
      `based on ${recentFailures.length} failure(s)`
  )

  const result = await invokeBackend({
    prompt,
    model: 'sonnet',
  })

  if (!result.ok) {
    logger.warn(`Failed to invoke backend for improvement: ${result.error.message}`)
    return null
  }

  const improvement = parseImprovementResponse(result.value.response)
  if (!improvement) {
    logger.warn('Failed to parse improvement response')
    return null
  }

  // Determine next version number
  const latest = getLatestVersion(currentVersion.personaName)
  const nextVersion = (latest?.version ?? 0) + 1

  const newVersion: PromptVersion = {
    id: generateVersionId(),
    personaName: currentVersion.personaName,
    parentVersionId: currentVersion.id,
    version: nextVersion,
    systemPrompt: improvement.improvedPrompt,
    changelog: improvement.changelog,
    stats: {
      totalTasks: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      avgDurationMs: 0,
    },
    status: 'candidate',
    createdAt: new Date().toISOString(),
  }

  savePromptVersion(newVersion)
  logger.info(
    `Created candidate version ${currentVersion.personaName} v${nextVersion}: ${improvement.changelog}`
  )

  return newVersion
}
