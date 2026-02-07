/**
 * WorkflowEventEmitter 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { workflowEvents } from '../WorkflowEventEmitter.js'
import type {
  NodeStartedEvent,
  NodeCompletedEvent,
  NodeFailedEvent,
  WorkflowStartedEvent,
  WorkflowCompletedEvent,
  WorkflowProgressEvent,
} from '../WorkflowEventEmitter.js'

describe('WorkflowEventEmitter', () => {
  beforeEach(() => {
    // 清理统计
    workflowEvents.clearStats()
    // 移除所有监听器
    workflowEvents.removeAllListeners()
  })

  describe('emitWorkflowStarted', () => {
    it('should emit workflow:started event', () => {
      const callback = vi.fn()
      workflowEvents.on('workflow:started', callback)

      workflowEvents.emitWorkflowStarted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        workflowName: 'Test Workflow',
        totalNodes: 5,
      })

      expect(callback).toHaveBeenCalledTimes(1)
      const event = callback.mock.calls[0]![0] as WorkflowStartedEvent
      expect(event.type).toBe('workflow:started')
      expect(event.workflowId).toBe('wf-1')
      expect(event.instanceId).toBe('inst-1')
      expect(event.workflowName).toBe('Test Workflow')
      expect(event.totalNodes).toBe(5)
      expect(event.timestamp).toBeDefined()
    })

    it('should initialize execution stats', () => {
      workflowEvents.emitWorkflowStarted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        workflowName: 'Test Workflow',
        totalNodes: 5,
      })

      const stats = workflowEvents.getExecutionStats('inst-1')
      expect(stats).toBeDefined()
      expect(stats?.workflowId).toBe('wf-1')
      expect(stats?.workflowName).toBe('Test Workflow')
      expect(stats?.status).toBe('running')
      expect(stats?.summary.totalNodes).toBe(5)
      expect(stats?.summary.pendingNodes).toBe(5)
      expect(stats?.summary.completedNodes).toBe(0)
    })
  })

  describe('emitNodeStarted', () => {
    it('should emit node:started event', () => {
      const callback = vi.fn()
      workflowEvents.on('node:started', callback)

      workflowEvents.emitNodeStarted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: 'Test Node',
        nodeType: 'task',
        attempt: 1,
      })

      expect(callback).toHaveBeenCalledTimes(1)
      const event = callback.mock.calls[0]![0] as NodeStartedEvent
      expect(event.type).toBe('node:started')
      expect(event.nodeId).toBe('node-1')
      expect(event.nodeName).toBe('Test Node')
      expect(event.nodeType).toBe('task')
      expect(event.attempt).toBe(1)
    })
  })

  describe('emitNodeCompleted', () => {
    beforeEach(() => {
      // 初始化工作流统计
      workflowEvents.emitWorkflowStarted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        workflowName: 'Test Workflow',
        totalNodes: 3,
      })
    })

    it('should emit node:completed event', () => {
      const callback = vi.fn()
      workflowEvents.on('node:completed', callback)

      workflowEvents.emitNodeCompleted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: 'Test Node',
        nodeType: 'task',
        durationMs: 1000,
        output: 'result',
        costUsd: 0.05,
      })

      expect(callback).toHaveBeenCalledTimes(1)
      const event = callback.mock.calls[0]![0] as NodeCompletedEvent
      expect(event.type).toBe('node:completed')
      expect(event.nodeId).toBe('node-1')
      expect(event.durationMs).toBe(1000)
      expect(event.costUsd).toBe(0.05)
    })

    it('should update execution stats', () => {
      workflowEvents.emitNodeCompleted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: 'Test Node',
        nodeType: 'task',
        durationMs: 1000,
        costUsd: 0.05,
      })

      const stats = workflowEvents.getExecutionStats('inst-1')
      expect(stats?.summary.completedNodes).toBe(1)
      expect(stats?.summary.pendingNodes).toBe(2)
      expect(stats?.summary.totalCostUsd).toBe(0.05)
    })

    it('should emit progress event', () => {
      const progressCallback = vi.fn()
      workflowEvents.on('workflow:progress', progressCallback)

      workflowEvents.emitNodeCompleted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: 'Test Node',
        nodeType: 'task',
        durationMs: 1000,
      })

      expect(progressCallback).toHaveBeenCalledTimes(1)
      const event = progressCallback.mock.calls[0]![0] as WorkflowProgressEvent
      expect(event.type).toBe('workflow:progress')
      expect(event.completed).toBe(1)
      expect(event.total).toBe(3)
      expect(event.percentage).toBe(33)
    })
  })

  describe('emitNodeFailed', () => {
    beforeEach(() => {
      workflowEvents.emitWorkflowStarted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        workflowName: 'Test Workflow',
        totalNodes: 3,
      })
    })

    it('should emit node:failed event with retry info', () => {
      const callback = vi.fn()
      workflowEvents.on('node:failed', callback)

      workflowEvents.emitNodeFailed({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: 'Test Node',
        nodeType: 'task',
        error: 'Test error',
        attempt: 1,
        willRetry: true,
      })

      expect(callback).toHaveBeenCalledTimes(1)
      const event = callback.mock.calls[0]![0] as NodeFailedEvent
      expect(event.type).toBe('node:failed')
      expect(event.error).toBe('Test error')
      expect(event.attempt).toBe(1)
      expect(event.willRetry).toBe(true)
    })

    it('should update execution stats on final failure', () => {
      workflowEvents.emitNodeFailed({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: 'Test Node',
        nodeType: 'task',
        error: 'Test error',
        attempt: 3,
        willRetry: false,
      })

      const stats = workflowEvents.getExecutionStats('inst-1')
      expect(stats?.summary.failedNodes).toBe(1)
    })
  })

  describe('emitWorkflowCompleted', () => {
    beforeEach(() => {
      workflowEvents.emitWorkflowStarted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        workflowName: 'Test Workflow',
        totalNodes: 2,
      })
    })

    it('should emit workflow:completed event', () => {
      const callback = vi.fn()
      workflowEvents.on('workflow:completed', callback)

      workflowEvents.emitWorkflowCompleted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        workflowName: 'Test Workflow',
        totalDurationMs: 5000,
        nodesCompleted: 2,
        nodesFailed: 0,
        totalCostUsd: 0.1,
      })

      expect(callback).toHaveBeenCalledTimes(1)
      const event = callback.mock.calls[0]![0] as WorkflowCompletedEvent
      expect(event.type).toBe('workflow:completed')
      expect(event.totalDurationMs).toBe(5000)
      expect(event.totalCostUsd).toBe(0.1)
    })

    it('should update execution stats status', () => {
      workflowEvents.emitWorkflowCompleted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        workflowName: 'Test Workflow',
        totalDurationMs: 5000,
        nodesCompleted: 2,
        nodesFailed: 0,
        totalCostUsd: 0.1,
      })

      const stats = workflowEvents.getExecutionStats('inst-1')
      expect(stats?.status).toBe('completed')
      expect(stats?.completedAt).toBeDefined()
    })
  })

  describe('subscription helpers', () => {
    it('onNodeEvent should capture all node events', () => {
      const callback = vi.fn()
      const unsubscribe = workflowEvents.onNodeEvent(callback)

      workflowEvents.emitNodeStarted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: 'Test',
        nodeType: 'task',
        attempt: 1,
      })

      workflowEvents.emitNodeCompleted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: 'Test',
        nodeType: 'task',
        durationMs: 1000,
      })

      expect(callback).toHaveBeenCalledTimes(2)

      // 取消订阅
      unsubscribe()

      workflowEvents.emitNodeStarted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        nodeId: 'node-2',
        nodeName: 'Test 2',
        nodeType: 'task',
        attempt: 1,
      })

      expect(callback).toHaveBeenCalledTimes(2) // 不应该增加
    })

    it('onProgress should track progress events', () => {
      const callback = vi.fn()
      workflowEvents.onProgress(callback)

      // 初始化工作流
      workflowEvents.emitWorkflowStarted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        workflowName: 'Test',
        totalNodes: 2,
      })

      // 完成节点会触发进度事件
      workflowEvents.emitNodeCompleted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        nodeId: 'node-1',
        nodeName: 'Test',
        nodeType: 'task',
        durationMs: 1000,
      })

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0]![0].percentage).toBe(50)
    })
  })

  describe('getAllExecutionStats', () => {
    it('should return all execution stats', () => {
      workflowEvents.emitWorkflowStarted({
        workflowId: 'wf-1',
        instanceId: 'inst-1',
        workflowName: 'Workflow 1',
        totalNodes: 2,
      })

      workflowEvents.emitWorkflowStarted({
        workflowId: 'wf-2',
        instanceId: 'inst-2',
        workflowName: 'Workflow 2',
        totalNodes: 3,
      })

      const allStats = workflowEvents.getAllExecutionStats()
      expect(allStats).toHaveLength(2)
      expect(allStats.map(s => s.workflowName)).toContain('Workflow 1')
      expect(allStats.map(s => s.workflowName)).toContain('Workflow 2')
    })
  })
})
