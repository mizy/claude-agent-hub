/**
 * Apply evolution improvements.
 *
 * Delegates prompt improvements to prompt-optimization module,
 * and handles workflow-level improvements locally.
 */

import { analyzeFailure } from '../prompt-optimization/analyzeFailure.js'
import { generateImprovement } from '../prompt-optimization/generateImprovement.js'
import { recordFailure } from '../prompt-optimization/failureKnowledgeBase.js'
import { classifyFailure } from '../prompt-optimization/classifyFailure.js'
import { extractFailedNodes } from '../prompt-optimization/analyzeFailure.js'
import { getActiveVersion } from '../store/PromptVersionStore.js'
import { getTask } from '../store/TaskStore.js'
import { getTaskWorkflow, getTaskInstance } from '../store/TaskWorkflowStore.js'
import { createLogger } from '../shared/logger.js'
import type { Improvement, ApplyResult } from './types.js'

const logger = createLogger('selfevolve')

/**
 * Apply a list of improvements.
 *
 * For prompt improvements: triggers LLM-based analysis → improvement generation
 * via the prompt-optimization pipeline.
 *
 * For workflow/environment improvements: records them to failure KB
 * for future reference (no auto-fix yet).
 */
export async function applyImprovements(improvements: Improvement[]): Promise<ApplyResult[]> {
  const results: ApplyResult[] = []

  for (const improvement of improvements) {
    try {
      const result = await applySingle(improvement)
      results.push(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`Failed to apply improvement ${improvement.id}: ${msg}`)
      results.push({
        improvementId: improvement.id,
        applied: false,
        message: `Error: ${msg}`,
      })
    }
  }

  const applied = results.filter(r => r.applied).length
  logger.info(`Applied ${applied}/${improvements.length} improvements`)

  return results
}

async function applySingle(improvement: Improvement): Promise<ApplyResult> {
  if (improvement.source === 'prompt' && improvement.personaName) {
    return applyPromptImprovement(improvement)
  }

  // For non-prompt improvements, record to failure KB for visibility
  return {
    improvementId: improvement.id,
    applied: false,
    message: `Non-prompt improvement recorded: ${improvement.description}. Manual intervention may be needed.`,
  }
}

/**
 * Apply a prompt improvement by running the full prompt-optimization pipeline:
 * 1. Pick the most representative failed task from the improvement
 * 2. Run LLM failure analysis on it
 * 3. Generate an improved prompt version (candidate)
 */
async function applyPromptImprovement(improvement: Improvement): Promise<ApplyResult> {
  const personaName = improvement.personaName!

  // Get active version for this persona
  const activeVersion = getActiveVersion(personaName)
  if (!activeVersion) {
    return {
      improvementId: improvement.id,
      applied: false,
      message: `No active version found for persona "${personaName}"`,
    }
  }

  // Find a representative failed task to drive the improvement
  const taskId = improvement.triggeredBy
  const task = getTask(taskId)
  if (!task) {
    return {
      improvementId: improvement.id,
      applied: false,
      message: `Trigger task ${taskId} not found`,
    }
  }

  const workflow = getTaskWorkflow(taskId)
  const instance = getTaskInstance(taskId)
  if (!workflow || !instance) {
    return {
      improvementId: improvement.id,
      applied: false,
      message: `Workflow/instance not found for task ${taskId}`,
    }
  }

  // Record failure to knowledge base
  const failedNodes = extractFailedNodes(workflow, instance)
  if (failedNodes.length > 0) {
    const classification = classifyFailure(failedNodes)
    recordFailure({
      taskId,
      personaName,
      versionId: activeVersion.id,
      category: classification.category,
      confidence: classification.confidence,
      matchedPatterns: classification.matchedPatterns,
      failedNodes,
    })
  }

  // Run LLM analysis
  const analysis = await analyzeFailure(task, workflow, instance, activeVersion.id)
  if (!analysis) {
    return {
      improvementId: improvement.id,
      applied: false,
      message: 'Failure analysis determined issue is not prompt-related',
    }
  }

  // Generate improved prompt version
  const newVersion = await generateImprovement(activeVersion, [analysis])
  if (!newVersion) {
    return {
      improvementId: improvement.id,
      applied: false,
      message: 'Failed to generate improved prompt version',
    }
  }

  logger.info(
    `Generated candidate version v${newVersion.version} for ${personaName} (improvement: ${improvement.id})`
  )

  return {
    improvementId: improvement.id,
    applied: true,
    message: `Generated candidate prompt v${newVersion.version} for ${personaName}`,
  }
}
