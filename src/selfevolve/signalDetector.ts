/**
 * @entry Signal Detector - detect anomaly patterns from recent tasks
 *
 * Scans recent failed/completed tasks using a sliding window to identify
 * systemic error patterns that should trigger self-evolution.
 * Lightweight, synchronous, no AI calls.
 */

import { getTasksByStatus } from '../store/TaskStore.js'
import { getTaskInstance } from '../store/TaskWorkflowStore.js'
import { getLatestEvolution } from './evolutionHistory.js'
import { createLogger } from '../shared/logger.js'
import type { Task } from '../types/task.js'
import type { NodeState } from '../types/workflow.js'

const logger = createLogger('selfevolve:signal')

// ============ Types ============

export type SignalType =
  | 'expr_eval_failure'
  | 'workflow_dead_end'
  | 'node_timeout'
  | 'backend_error'
  | 'stable_success_plateau'

export type SignalSeverity = 'critical' | 'warning' | 'info'

export interface SignalEvent {
  type: SignalType
  count: number
  taskIds: string[]
  pattern: string
  severity: SignalSeverity
}

export interface DetectSignalOptions {
  /** Number of recent tasks to scan (default: 20) */
  windowSize?: number
}

// ============ Cooldown ============

const cooldownMap = new Map<SignalType, Date>()
const COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24h

export function resetSignalCooldowns(): void {
  cooldownMap.clear()
}

function isOnCooldown(type: SignalType): boolean {
  const lastFired = cooldownMap.get(type)
  if (!lastFired) return false
  return Date.now() - lastFired.getTime() < COOLDOWN_MS
}

function markFired(type: SignalType): void {
  cooldownMap.set(type, new Date())
}

// ============ Helpers ============

interface FailedNodeInfo {
  taskId: string
  nodeId: string
  error: string
}

function collectFailedNodes(tasks: Task[]): FailedNodeInfo[] {
  const results: FailedNodeInfo[] = []
  for (const task of tasks) {
    const instance = getTaskInstance(task.id)
    if (!instance?.nodeStates) continue
    for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
      const ns = state as NodeState
      if (ns.status === 'failed' && ns.error) {
        results.push({ taskId: task.id, nodeId, error: ns.error })
      }
    }
  }
  return results
}

function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some(k => lower.includes(k))
}

// ============ Individual Detectors ============

function detectExprEvalFailure(failedNodes: FailedNodeInfo[]): SignalEvent | null {
  const keywords = ['expression', 'eval', 'condition']
  const matches = failedNodes.filter(n => matchesAny(n.error, keywords))
  if (matches.length < 3) return null
  const taskIds = [...new Set(matches.map(m => m.taskId))]
  return {
    type: 'expr_eval_failure',
    count: matches.length,
    taskIds,
    pattern: `Expression/eval failures in ${matches.length} nodes across ${taskIds.length} tasks`,
    severity: 'critical',
  }
}

function detectWorkflowDeadEnd(failedNodes: FailedNodeInfo[]): SignalEvent | null {
  const keywords = ['dead end', 'no matching', 'all conditions false']
  const matches = failedNodes.filter(n => matchesAny(n.error, keywords))
  if (matches.length < 3) return null
  const taskIds = [...new Set(matches.map(m => m.taskId))]
  return {
    type: 'workflow_dead_end',
    count: matches.length,
    taskIds,
    pattern: `Workflow dead-end failures in ${matches.length} nodes across ${taskIds.length} tasks`,
    severity: 'warning',
  }
}

function detectNodeTimeout(failedNodes: FailedNodeInfo[]): SignalEvent | null {
  const keywords = ['timeout', 'timed out']
  const matches = failedNodes.filter(n => matchesAny(n.error, keywords))
  if (matches.length < 3) return null
  const taskIds = [...new Set(matches.map(m => m.taskId))]
  return {
    type: 'node_timeout',
    count: matches.length,
    taskIds,
    pattern: `Timeout failures in ${matches.length} nodes across ${taskIds.length} tasks`,
    severity: 'warning',
  }
}

function detectBackendError(failedNodes: FailedNodeInfo[]): SignalEvent | null {
  const keywords = ['backend', 'invoke', 'spawn']
  const excludeKeywords = ['timeout']
  const matches = failedNodes.filter(
    n => matchesAny(n.error, keywords) && !matchesAny(n.error, excludeKeywords)
  )
  if (matches.length < 3) return null
  const taskIds = [...new Set(matches.map(m => m.taskId))]
  return {
    type: 'backend_error',
    count: matches.length,
    taskIds,
    pattern: `Backend/invoke failures in ${matches.length} nodes across ${taskIds.length} tasks`,
    severity: 'critical',
  }
}

function detectStableSuccessPlateau(tasks: Task[]): SignalEvent | null {
  if (tasks.length < 10) return null
  const successCount = tasks.filter(t => t.status === 'completed').length
  const successRate = successCount / tasks.length
  if (successRate < 0.95) return null

  const latest = getLatestEvolution()
  if (latest) {
    const daysSince =
      (Date.now() - new Date(latest.startedAt).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSince < 7) return null
  }

  return {
    type: 'stable_success_plateau',
    count: successCount,
    taskIds: tasks.map(t => t.id),
    pattern: `Success rate ${(successRate * 100).toFixed(0)}% over ${tasks.length} tasks, no evolution in 7+ days`,
    severity: 'info',
  }
}

// ============ Main ============

/** Detect anomaly signals from recent tasks */
export function detectSignals(options?: DetectSignalOptions): SignalEvent[] {
  const windowSize = options?.windowSize ?? 20

  // Collect recent tasks (both completed and failed), sorted newest first
  const allTasks: Task[] = []
  for (const status of ['completed', 'failed'] as const) {
    allTasks.push(...getTasksByStatus(status))
  }
  allTasks.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  const tasks = allTasks.slice(0, windowSize)

  if (tasks.length === 0) {
    logger.debug('No tasks to analyze for signals')
    return []
  }

  // Collect all failed nodes from these tasks
  const failedNodes = collectFailedNodes(tasks)

  // Run all detectors
  const candidates: (SignalEvent | null)[] = [
    detectExprEvalFailure(failedNodes),
    detectWorkflowDeadEnd(failedNodes),
    detectNodeTimeout(failedNodes),
    detectBackendError(failedNodes),
    detectStableSuccessPlateau(tasks),
  ]

  // Filter nulls and apply cooldown
  const signals: SignalEvent[] = []
  for (const signal of candidates) {
    if (!signal) continue
    if (isOnCooldown(signal.type)) {
      logger.debug(`Signal ${signal.type} is on cooldown, skipping`)
      continue
    }
    markFired(signal.type)
    signals.push(signal)
  }

  if (signals.length > 0) {
    logger.info(`Detected ${signals.length} signal(s): ${signals.map(s => s.type).join(', ')}`)
  }

  return signals
}
