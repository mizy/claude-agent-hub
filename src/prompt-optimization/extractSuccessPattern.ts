/**
 * Extract reusable workflow patterns from successfully completed tasks.
 *
 * Clusters tasks by workflow node sequences and computes aggregate stats
 * to identify proven execution patterns.
 */

import { join } from 'path'
import { FileStore } from '../store/GenericFileStore.js'
import { DATA_DIR } from '../store/paths.js'
import { getTaskWorkflow, getTaskInstance } from '../store/TaskWorkflowStore.js'
import { generateShortId } from '../shared/generateId.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../types/workflow.js'

// ============ Types ============

export interface SuccessPattern {
  id: string
  taskType: string
  nodeSequence: string[]
  agentAssignments: Record<string, string>
  avgDuration: number
  sampleCount: number
  confidence: number
  extractedAt: string
}

// ============ Store ============

const SUCCESS_PATTERNS_DIR = join(DATA_DIR, 'success-patterns')

const patternStore = new FileStore<SuccessPattern>({
  dir: SUCCESS_PATTERNS_DIR,
  mode: 'file',
  ext: '.json',
})

export function savePattern(pattern: SuccessPattern): void {
  patternStore.setSync(pattern.id, pattern)
}

export function getAllPatterns(): SuccessPattern[] {
  return patternStore.getAllSync()
}

// ============ Extraction ============

interface TaskData {
  task: Task
  workflow: Workflow
  instance: WorkflowInstance
}

function loadTaskData(task: Task): TaskData | null {
  const workflow = getTaskWorkflow(task.id)
  if (!workflow) return null
  const instance = getTaskInstance(task.id)
  if (!instance) return null
  return { task, workflow, instance }
}

/** Extract node name sequence from workflow, ignoring start/end nodes */
function extractNodeSequence(workflow: Workflow): string[] {
  return workflow.nodes
    .filter(n => n.type !== 'start' && n.type !== 'end')
    .map(n => n.name)
}

/** Extract agent (persona) assignments from workflow task nodes */
function extractAgentAssignments(workflow: Workflow): Record<string, string> {
  const assignments: Record<string, string> = {}
  for (const node of workflow.nodes) {
    if (node.task?.persona) {
      assignments[node.id] = node.task.persona
    }
  }
  return assignments
}

/** Compute total duration from instance timestamps (ms) */
function computeDuration(instance: WorkflowInstance): number {
  if (!instance.startedAt || !instance.completedAt) return 0
  return new Date(instance.completedAt).getTime() - new Date(instance.startedAt).getTime()
}

/** Compute edit distance between two string arrays */
function editDistance(a: string[], b: string[]): number {
  const m = a.length
  const n = b.length
  // Use flat array for DP table to avoid TS strict indexing issues
  const dp: number[] = new Array((m + 1) * (n + 1)).fill(0)
  const idx = (i: number, j: number) => i * (n + 1) + j

  for (let i = 0; i <= m; i++) dp[idx(i, 0)] = i
  for (let j = 0; j <= n; j++) dp[idx(0, j)] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[idx(i, j)] = dp[idx(i - 1, j - 1)]!
      } else {
        dp[idx(i, j)] = 1 + Math.min(
          dp[idx(i - 1, j)]!,
          dp[idx(i, j - 1)]!,
          dp[idx(i - 1, j - 1)]!
        )
      }
    }
  }
  return dp[idx(m, n)]!
}

/** Check if two sequences are similar (edit distance < 30% of max length) */
function isSimilar(a: string[], b: string[]): boolean {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return true
  return editDistance(a, b) < maxLen * 0.3
}

/** Infer task type from node sequence keywords */
function inferTaskType(nodeNames: string[]): string {
  const joined = nodeNames.join(' ').toLowerCase()
  if (joined.includes('test') || joined.includes('测试')) return 'testing'
  if (joined.includes('refactor') || joined.includes('重构')) return 'refactoring'
  if (joined.includes('fix') || joined.includes('修复')) return 'bugfix'
  if (joined.includes('review') || joined.includes('审查')) return 'review'
  return 'feature'
}

interface Cluster {
  sequences: string[][]
  durations: number[]
  agentAssignments: Record<string, string>[]
}

/**
 * Extract success patterns from completed tasks.
 *
 * Groups tasks by similar workflow node sequences and computes
 * aggregate stats for each pattern.
 */
export function extractSuccessPatterns(tasks: Task[], limit = 20): SuccessPattern[] {
  // Load workflow/instance data for completed tasks
  const dataItems: TaskData[] = []
  for (const task of tasks) {
    if (task.status !== 'completed') continue
    const data = loadTaskData(task)
    if (data) dataItems.push(data)
  }

  if (dataItems.length === 0) return []

  // Cluster by similar node sequences
  const clusters: Cluster[] = []

  for (const item of dataItems) {
    const seq = extractNodeSequence(item.workflow)
    if (seq.length === 0) continue

    const duration = computeDuration(item.instance)
    const agents = extractAgentAssignments(item.workflow)

    let matched = false
    for (const cluster of clusters) {
      if (isSimilar(cluster.sequences[0]!, seq)) {
        cluster.sequences.push(seq)
        cluster.durations.push(duration)
        cluster.agentAssignments.push(agents)
        matched = true
        break
      }
    }

    if (!matched) {
      clusters.push({
        sequences: [seq],
        durations: [duration],
        agentAssignments: [agents],
      })
    }
  }

  // Convert clusters to patterns
  const patterns: SuccessPattern[] = clusters.map(cluster => {
    const representative = cluster.sequences[0]!
    const avgDuration = Math.round(
      cluster.durations.reduce((a, b) => a + b, 0) / cluster.durations.length
    )
    const sampleCount = cluster.sequences.length

    return {
      id: `sp-${generateShortId()}`,
      taskType: inferTaskType(representative),
      nodeSequence: representative,
      agentAssignments: cluster.agentAssignments[0]!,
      avgDuration,
      sampleCount,
      confidence: Math.min(1, sampleCount / 5),
      extractedAt: new Date().toISOString(),
    }
  })

  // Sort by sampleCount descending, limit results
  patterns.sort((a, b) => b.sampleCount - a.sampleCount)
  return patterns.slice(0, limit)
}

/**
 * Find a matching pattern for a task description.
 *
 * Uses simple keyword matching against pattern taskType and nodeSequence.
 */
export function findMatchingPattern(
  description: string,
  patterns: SuccessPattern[]
): SuccessPattern | null {
  if (patterns.length === 0) return null

  const keywords = description
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)

  let bestPattern: SuccessPattern | null = null
  let bestScore = 0

  for (const pattern of patterns) {
    let score = 0
    const patternText = [pattern.taskType, ...pattern.nodeSequence].join(' ').toLowerCase()

    for (const keyword of keywords) {
      if (patternText.includes(keyword)) {
        score += 1
      }
    }

    // Weight by confidence
    score *= pattern.confidence

    if (score > bestScore) {
      bestScore = score
      bestPattern = pattern
    }
  }

  return bestScore > 0 ? bestPattern : null
}
