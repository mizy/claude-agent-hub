/**
 * ExecutionStats 测试
 *
 * 覆盖 deriveStatsFromInstance — 纯函数，从 instance 派生统计数据
 */

import { describe, it, expect } from 'vitest'
import { deriveStatsFromInstance } from '../src/task/ExecutionStats.js'
import type { WorkflowInstance } from '../src/workflow/types.js'

function createInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: 'inst-1',
    workflowId: 'wf-1',
    status: 'running',
    nodeStates: {},
    variables: {},
    outputs: {},
    loopCounts: {},
    ...overrides,
  }
}

describe('deriveStatsFromInstance', () => {
  it('should handle empty instance (no nodes)', () => {
    const instance = createInstance()
    const stats = deriveStatsFromInstance('task-1', instance, 'Test Workflow')

    expect(stats.workflowId).toBe('wf-1')
    expect(stats.instanceId).toBe('inst-1')
    expect(stats.workflowName).toBe('Test Workflow')
    expect(stats.status).toBe('running')
    expect(stats.nodes).toHaveLength(0)
    expect(stats.summary.totalNodes).toBe(0)
    expect(stats.summary.completedNodes).toBe(0)
    expect(stats.summary.failedNodes).toBe(0)
    expect(stats.summary.avgNodeDurationMs).toBe(0)
  })

  it('should count completed nodes correctly', () => {
    const instance = createInstance({
      nodeStates: {
        node1: { status: 'done', attempts: 1, durationMs: 1000 },
        node2: { status: 'done', attempts: 1, durationMs: 3000 },
        node3: { status: 'running', attempts: 1 },
      },
    })

    const stats = deriveStatsFromInstance('task-1', instance, 'WF')

    expect(stats.summary.totalNodes).toBe(3)
    expect(stats.summary.completedNodes).toBe(2)
    expect(stats.summary.runningNodes).toBe(1)
    expect(stats.summary.avgNodeDurationMs).toBe(2000) // (1000 + 3000) / 2
  })

  it('should count failed nodes', () => {
    const instance = createInstance({
      nodeStates: {
        node1: { status: 'done', attempts: 1, durationMs: 500 },
        node2: { status: 'failed', attempts: 3, error: 'timeout' },
      },
    })

    const stats = deriveStatsFromInstance('task-1', instance, 'WF')

    expect(stats.summary.completedNodes).toBe(1)
    expect(stats.summary.failedNodes).toBe(1)
    expect(stats.nodes.find(n => n.nodeId === 'node2')?.error).toBe('timeout')
  })

  it('should count skipped nodes', () => {
    const instance = createInstance({
      nodeStates: {
        node1: { status: 'skipped', attempts: 0 },
        node2: { status: 'done', attempts: 1 },
      },
    })

    const stats = deriveStatsFromInstance('task-1', instance, 'WF')

    expect(stats.summary.skippedNodes).toBe(1)
    expect(stats.summary.completedNodes).toBe(1)
  })

  it('should count pending/ready/waiting as pending', () => {
    const instance = createInstance({
      nodeStates: {
        node1: { status: 'pending', attempts: 0 },
        node2: { status: 'ready', attempts: 0 },
        node3: { status: 'waiting', attempts: 0 },
      },
    })

    const stats = deriveStatsFromInstance('task-1', instance, 'WF')

    expect(stats.summary.pendingNodes).toBe(3)
  })

  it('should extract costUsd from output', () => {
    const instance = createInstance({
      nodeStates: {
        node1: { status: 'done', attempts: 1, durationMs: 1000 },
      },
      outputs: {
        node1: { costUsd: 0.05, result: 'ok' },
      },
    })

    const stats = deriveStatsFromInstance('task-1', instance, 'WF')

    expect(stats.summary.totalCostUsd).toBe(0.05)
    expect(stats.nodes[0]?.costUsd).toBe(0.05)
  })

  it('should sum costs across multiple nodes', () => {
    const instance = createInstance({
      nodeStates: {
        node1: { status: 'done', attempts: 1, durationMs: 500 },
        node2: { status: 'done', attempts: 1, durationMs: 500 },
      },
      outputs: {
        node1: { costUsd: 0.03 },
        node2: { costUsd: 0.07 },
      },
    })

    const stats = deriveStatsFromInstance('task-1', instance, 'WF')

    expect(stats.summary.totalCostUsd).toBeCloseTo(0.1)
  })

  it('should calculate total duration from startedAt/completedAt', () => {
    const instance = createInstance({
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:05:00.000Z',
      nodeStates: {
        node1: { status: 'done', attempts: 1, durationMs: 300000 },
      },
    })

    const stats = deriveStatsFromInstance('task-1', instance, 'WF')

    expect(stats.totalDurationMs).toBe(300000) // 5 minutes
  })

  it('should handle missing output gracefully', () => {
    const instance = createInstance({
      nodeStates: {
        node1: { status: 'done', attempts: 1, durationMs: 1000 },
      },
      // No outputs entry for node1
    })

    const stats = deriveStatsFromInstance('task-1', instance, 'WF')

    expect(stats.nodes[0]?.costUsd).toBeUndefined()
    expect(stats.summary.totalCostUsd).toBe(0)
  })
})
