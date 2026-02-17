/**
 * Extract reusable memories from completed task executions
 *
 * Calls AI backend to analyze task results and extract lessons learned.
 * Designed to be non-blocking — failures are logged but never thrown.
 */

import { invokeBackend } from '../backend/index.js'
import { buildMemoryExtractionPrompt, type TaskSummary } from '../prompts/memoryPrompts.js'
import { addMemory } from './manageMemory.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'
import type { MemoryCategory, MemoryEntry } from './types.js'

const logger = createLogger('memory')

const MAX_MEMORIES_PER_TASK = 5
const VALID_CATEGORIES: MemoryCategory[] = ['pattern', 'lesson', 'preference', 'pitfall', 'tool']

function buildTaskSummary(
  task: Task,
  workflow: Workflow,
  instance: WorkflowInstance,
): TaskSummary {
  const nodes = workflow.nodes
    .filter(n => n.type === 'task')
    .map(n => {
      const state = instance.nodeStates[n.id]
      return {
        name: n.name,
        status: state?.status ?? 'unknown',
        error: state?.error,
      }
    })

  const startedAt = instance.startedAt ? new Date(instance.startedAt).getTime() : 0
  const completedAt = instance.completedAt ? new Date(instance.completedAt).getTime() : Date.now()
  const totalDurationMs = startedAt ? completedAt - startedAt : 0

  return {
    title: task.title,
    description: task.description,
    nodes,
    totalDurationMs,
    finalStatus: instance.status,
  }
}

interface RawExtraction {
  content: string
  category: string
  keywords: string[]
  confidence: number
}

function parseExtractions(text: string): RawExtraction[] {
  // Try to find JSON array in response (may have markdown fences or extra text)
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    logger.warn('Failed to parse memory extraction JSON')
    return []
  }
}

function isValidExtraction(item: RawExtraction): boolean {
  return (
    typeof item.content === 'string' &&
    item.content.length > 0 &&
    VALID_CATEGORIES.includes(item.category as MemoryCategory) &&
    Array.isArray(item.keywords) &&
    typeof item.confidence === 'number' &&
    item.confidence >= 0 &&
    item.confidence <= 1
  )
}

export async function extractMemoryFromTask(
  task: Task,
  workflow: Workflow,
  instance: WorkflowInstance,
): Promise<MemoryEntry[]> {
  try {
    const summary = buildTaskSummary(task, workflow, instance)
    const prompt = buildMemoryExtractionPrompt(summary)

    const result = await invokeBackend({
      prompt,
      mode: 'review',
      disableMcp: true,
      timeoutMs: 60_000,
    })

    if (!result.ok) {
      logger.warn(`Memory extraction backend call failed: ${result.error.message}`)
      return []
    }

    const extractions = parseExtractions(result.value.response)
    if (extractions.length === 0) {
      logger.info('No memories extracted from task')
      return []
    }

    const entries: MemoryEntry[] = []

    for (const item of extractions.slice(0, MAX_MEMORIES_PER_TASK)) {
      if (!isValidExtraction(item)) {
        logger.warn(`Skipping invalid memory extraction: ${JSON.stringify(item).slice(0, 100)}`)
        continue
      }

      const entry = addMemory(item.content, item.category as MemoryCategory, {
        type: 'task',
        taskId: task.id,
      }, {
        keywords: item.keywords,
        confidence: item.confidence,
      })

      entries.push(entry)
    }

    logger.info(`Extracted ${entries.length} memories from task ${task.id}`)
    return entries
  } catch (error) {
    logger.warn(`Memory extraction failed: ${getErrorMessage(error)}`)
    return []
  }
}
