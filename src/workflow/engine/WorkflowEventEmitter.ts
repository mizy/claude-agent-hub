/**
 * Workflow 执行事件发射器
 * 提供结构化的执行事件，支持可观测性和统计分析
 */

import { EventEmitter } from 'events'
import { createLogger } from '../../shared/logger.js'
import type { WorkflowEvent, WorkflowStatus } from '../types.js'

const logger = createLogger('workflow-events')

// ============ 扩展事件类型 ============

export interface NodeStartedEvent extends WorkflowEvent {
  type: 'node:started'
  nodeId: string
  nodeName: string
  nodeType: string
  attempt: number
}

export interface NodeCompletedEvent extends WorkflowEvent {
  type: 'node:completed'
  nodeId: string
  nodeName: string
  nodeType: string
  durationMs: number
  output?: unknown
  costUsd?: number
}

export interface NodeFailedEvent extends WorkflowEvent {
  type: 'node:failed'
  nodeId: string
  nodeName: string
  nodeType: string
  error: string
  attempt: number
  willRetry: boolean
}

export interface WorkflowStartedEvent extends WorkflowEvent {
  type: 'workflow:started'
  workflowName: string
  totalNodes: number
}

export interface WorkflowCompletedEvent extends WorkflowEvent {
  type: 'workflow:completed'
  workflowName: string
  totalDurationMs: number
  nodesCompleted: number
  nodesFailed: number
  totalCostUsd: number
}

export interface WorkflowFailedEvent extends WorkflowEvent {
  type: 'workflow:failed'
  workflowName: string
  error: string
  totalDurationMs: number
  nodesCompleted: number
}

export interface WorkflowProgressEvent {
  type: 'workflow:progress'
  workflowId: string
  instanceId: string
  timestamp: string
  completed: number
  total: number
  percentage: number
  currentNode?: string
}

// ============ 执行统计 ============

export interface NodeExecutionStats {
  nodeId: string
  nodeName: string
  nodeType: string
  status: 'completed' | 'failed' | 'skipped' | 'running' | 'pending'
  attempts: number
  durationMs?: number
  costUsd?: number
  error?: string
}

export interface WorkflowExecutionStats {
  workflowId: string
  instanceId: string
  workflowName: string
  status: WorkflowStatus
  startedAt?: string
  completedAt?: string
  totalDurationMs: number
  nodes: NodeExecutionStats[]
  summary: {
    totalNodes: number
    completedNodes: number
    failedNodes: number
    skippedNodes: number
    runningNodes: number
    pendingNodes: number
    totalCostUsd: number
    avgNodeDurationMs: number
  }
}

// ============ 事件发射器单例 ============

class WorkflowEventEmitter extends EventEmitter {
  private executionStats: Map<string, WorkflowExecutionStats> = new Map()

  constructor() {
    super()
    this.setMaxListeners(50)
  }

  // ============ 发射事件 ============

  emitNodeStarted(event: Omit<NodeStartedEvent, 'type' | 'timestamp'>): void {
    const fullEvent: NodeStartedEvent = {
      ...event,
      type: 'node:started',
      timestamp: new Date().toISOString(),
    }
    this.emit('node:started', fullEvent)
    this.emit('*', fullEvent)

    // 更新统计
    this.updateNodeStats(event.instanceId, event.nodeId, {
      nodeId: event.nodeId,
      nodeName: event.nodeName,
      nodeType: event.nodeType,
      status: 'running',
      attempts: event.attempt,
    })

    logger.debug(`Event: node:started - ${event.nodeId} (attempt ${event.attempt})`)
  }

  emitNodeCompleted(event: Omit<NodeCompletedEvent, 'type' | 'timestamp'>): void {
    const fullEvent: NodeCompletedEvent = {
      ...event,
      type: 'node:completed',
      timestamp: new Date().toISOString(),
    }
    this.emit('node:completed', fullEvent)
    this.emit('*', fullEvent)

    // 更新统计
    this.updateNodeStats(event.instanceId, event.nodeId, {
      nodeId: event.nodeId,
      nodeName: event.nodeName,
      nodeType: event.nodeType,
      status: 'completed',
      attempts: 1, // Will be updated with actual value
      durationMs: event.durationMs,
      costUsd: event.costUsd,
    })

    // 发射进度事件
    this.emitProgress(event.instanceId)

    logger.debug(`Event: node:completed - ${event.nodeId} (${event.durationMs}ms)`)
  }

  emitNodeFailed(event: Omit<NodeFailedEvent, 'type' | 'timestamp'>): void {
    // 确保错误信息不为空
    const errorMessage = event.error || 'Unknown error (no error message provided)'
    const fullEvent: NodeFailedEvent = {
      ...event,
      error: errorMessage,
      type: 'node:failed',
      timestamp: new Date().toISOString(),
    }
    this.emit('node:failed', fullEvent)
    this.emit('*', fullEvent)

    // 更新统计
    this.updateNodeStats(event.instanceId, event.nodeId, {
      nodeId: event.nodeId,
      nodeName: event.nodeName,
      nodeType: event.nodeType,
      status: event.willRetry ? 'running' : 'failed',
      attempts: event.attempt,
      error: errorMessage,
    })

    logger.debug(`Event: node:failed - ${event.nodeId} (attempt ${event.attempt}, retry: ${event.willRetry})`)
  }

  emitNodeSkipped(event: { workflowId: string; instanceId: string; nodeId: string; nodeName: string; nodeType: string }): void {
    const fullEvent: WorkflowEvent = {
      ...event,
      type: 'node:skipped',
      timestamp: new Date().toISOString(),
    }
    this.emit('node:skipped', fullEvent)
    this.emit('*', fullEvent)

    // 更新统计
    this.updateNodeStats(event.instanceId, event.nodeId, {
      nodeId: event.nodeId,
      nodeName: event.nodeName,
      nodeType: event.nodeType,
      status: 'skipped',
      attempts: 0,
    })

    logger.debug(`Event: node:skipped - ${event.nodeId}`)
  }

  emitWorkflowStarted(event: Omit<WorkflowStartedEvent, 'type' | 'timestamp'>): void {
    const fullEvent: WorkflowStartedEvent = {
      ...event,
      type: 'workflow:started',
      timestamp: new Date().toISOString(),
    }
    this.emit('workflow:started', fullEvent)
    this.emit('*', fullEvent)

    // 初始化统计
    this.executionStats.set(event.instanceId, {
      workflowId: event.workflowId,
      instanceId: event.instanceId,
      workflowName: event.workflowName,
      status: 'running',
      startedAt: fullEvent.timestamp,
      totalDurationMs: 0,
      nodes: [],
      summary: {
        totalNodes: event.totalNodes,
        completedNodes: 0,
        failedNodes: 0,
        skippedNodes: 0,
        runningNodes: 0,
        pendingNodes: event.totalNodes,
        totalCostUsd: 0,
        avgNodeDurationMs: 0,
      },
    })

    logger.info(`Event: workflow:started - ${event.workflowName} (${event.totalNodes} nodes)`)
  }

  emitWorkflowCompleted(event: Omit<WorkflowCompletedEvent, 'type' | 'timestamp'>): void {
    const fullEvent: WorkflowCompletedEvent = {
      ...event,
      type: 'workflow:completed',
      timestamp: new Date().toISOString(),
    }
    this.emit('workflow:completed', fullEvent)
    this.emit('*', fullEvent)

    // 更新统计
    const stats = this.executionStats.get(event.instanceId)
    if (stats) {
      stats.status = 'completed'
      stats.completedAt = fullEvent.timestamp
      stats.totalDurationMs = event.totalDurationMs
      stats.summary.totalCostUsd = event.totalCostUsd
    }

    logger.info(`Event: workflow:completed - ${event.workflowName} (${event.totalDurationMs}ms, $${event.totalCostUsd.toFixed(4)})`)
  }

  emitWorkflowFailed(event: Omit<WorkflowFailedEvent, 'type' | 'timestamp'>): void {
    // 确保错误信息不为空
    const errorMessage = event.error || 'Unknown error (no error message provided)'
    const fullEvent: WorkflowFailedEvent = {
      ...event,
      error: errorMessage,
      type: 'workflow:failed',
      timestamp: new Date().toISOString(),
    }
    this.emit('workflow:failed', fullEvent)
    this.emit('*', fullEvent)

    // 更新统计
    const stats = this.executionStats.get(event.instanceId)
    if (stats) {
      stats.status = 'failed'
      stats.completedAt = fullEvent.timestamp
      stats.totalDurationMs = event.totalDurationMs
    }

    logger.error(`Event: workflow:failed - ${event.workflowName}: ${errorMessage}`)
  }

  // ============ 进度事件 ============

  private emitProgress(instanceId: string): void {
    const stats = this.executionStats.get(instanceId)
    if (!stats) return

    const completed = stats.summary.completedNodes + stats.summary.skippedNodes
    const total = stats.summary.totalNodes
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

    const progressEvent: WorkflowProgressEvent = {
      type: 'workflow:progress',
      workflowId: stats.workflowId,
      instanceId,
      timestamp: new Date().toISOString(),
      completed,
      total,
      percentage,
    }

    this.emit('workflow:progress', progressEvent)
  }

  // ============ 统计管理 ============

  private updateNodeStats(instanceId: string, nodeId: string, stats: NodeExecutionStats): void {
    const workflowStats = this.executionStats.get(instanceId)
    if (!workflowStats) return

    // 查找或创建节点统计
    const existingIndex = workflowStats.nodes.findIndex(n => n.nodeId === nodeId)
    if (existingIndex >= 0) {
      // 合并统计
      const existing = workflowStats.nodes[existingIndex]!
      workflowStats.nodes[existingIndex] = {
        ...existing,
        ...stats,
        attempts: Math.max(existing.attempts, stats.attempts),
        durationMs: stats.durationMs ?? existing.durationMs,
        costUsd: stats.costUsd ?? existing.costUsd,
      }
    } else {
      workflowStats.nodes.push(stats)
    }

    // 更新汇总
    this.recalculateSummary(workflowStats)
  }

  private recalculateSummary(stats: WorkflowExecutionStats): void {
    let completedNodes = 0
    let failedNodes = 0
    let skippedNodes = 0
    let runningNodes = 0
    let totalCostUsd = 0
    let totalDurationMs = 0
    let completedCount = 0

    for (const node of stats.nodes) {
      switch (node.status) {
        case 'completed':
          completedNodes++
          if (node.durationMs) {
            totalDurationMs += node.durationMs
            completedCount++
          }
          if (node.costUsd) totalCostUsd += node.costUsd
          break
        case 'failed':
          failedNodes++
          break
        case 'skipped':
          skippedNodes++
          break
        case 'running':
          runningNodes++
          break
      }
    }

    stats.summary = {
      totalNodes: stats.summary.totalNodes,
      completedNodes,
      failedNodes,
      skippedNodes,
      runningNodes,
      pendingNodes: stats.summary.totalNodes - completedNodes - failedNodes - skippedNodes - runningNodes,
      totalCostUsd,
      avgNodeDurationMs: completedCount > 0 ? Math.round(totalDurationMs / completedCount) : 0,
    }
  }

  // ============ 获取统计 ============

  getExecutionStats(instanceId: string): WorkflowExecutionStats | undefined {
    return this.executionStats.get(instanceId)
  }

  getAllExecutionStats(): WorkflowExecutionStats[] {
    return Array.from(this.executionStats.values())
  }

  clearStats(instanceId?: string): void {
    if (instanceId) {
      this.executionStats.delete(instanceId)
    } else {
      this.executionStats.clear()
    }
  }

  // ============ 订阅助手 ============

  onNodeEvent(callback: (event: WorkflowEvent) => void): () => void {
    const handler = (event: WorkflowEvent) => {
      if (event.type.startsWith('node:')) {
        callback(event)
      }
    }
    this.on('*', handler)
    return () => this.off('*', handler)
  }

  onWorkflowEvent(callback: (event: WorkflowEvent) => void): () => void {
    const handler = (event: WorkflowEvent) => {
      if (event.type.startsWith('workflow:')) {
        callback(event)
      }
    }
    this.on('*', handler)
    return () => this.off('*', handler)
  }

  onProgress(callback: (event: WorkflowProgressEvent) => void): () => void {
    this.on('workflow:progress', callback)
    return () => this.off('workflow:progress', callback)
  }
}

// 单例导出
export const workflowEvents = new WorkflowEventEmitter()

// 导出类型
export type { WorkflowEventEmitter }
