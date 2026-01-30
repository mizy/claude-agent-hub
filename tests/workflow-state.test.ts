/**
 * 工作流状态管理测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  isNodeCompleted,
  isNodeRunnable,
  getActiveNodes,
  getPendingNodes,
  getCompletedNodes,
  getFailedNodes,
  getWorkflowProgress,
  checkWorkflowCompletion,
} from '../src/workflow/engine/StateManager.js'
import type { WorkflowInstance, Workflow, NodeState, NodeStatus } from '../src/workflow/types.js'

// 辅助函数：创建节点状态
function createNodeState(status: NodeStatus, extra: Partial<NodeState> = {}): NodeState {
  return {
    status,
    attempts: 0,
    ...extra,
  }
}

// 辅助函数：创建工作流实例
function createInstance(nodeStates: Record<string, NodeState>): WorkflowInstance {
  return {
    id: 'inst-1',
    workflowId: 'wf-1',
    status: 'running',
    nodeStates,
    variables: {},
    outputs: {},
    loopCounts: {},
  }
}

// 辅助函数：创建工作流定义
function createWorkflow(nodeCount: number): Workflow {
  const nodes = [
    { id: 'start', type: 'start' as const, name: '开始' },
    { id: 'end', type: 'end' as const, name: '结束' },
  ]

  for (let i = 1; i <= nodeCount; i++) {
    nodes.push({
      id: `task-${i}`,
      type: 'task' as const,
      name: `任务${i}`,
      task: { agent: 'auto', prompt: `任务${i}` },
    })
  }

  return {
    id: 'wf-1',
    name: '测试工作流',
    description: '',
    nodes,
    edges: [],
    variables: {},
    createdAt: new Date().toISOString(),
  }
}

describe('节点状态判断', () => {
  describe('isNodeCompleted', () => {
    it('should return true for done status', () => {
      expect(isNodeCompleted(createNodeState('done'))).toBe(true)
    })

    it('should return true for skipped status', () => {
      expect(isNodeCompleted(createNodeState('skipped'))).toBe(true)
    })

    it('should return false for pending status', () => {
      expect(isNodeCompleted(createNodeState('pending'))).toBe(false)
    })

    it('should return false for running status', () => {
      expect(isNodeCompleted(createNodeState('running'))).toBe(false)
    })

    it('should return false for failed status', () => {
      expect(isNodeCompleted(createNodeState('failed'))).toBe(false)
    })
  })

  describe('isNodeRunnable', () => {
    it('should return true for pending status', () => {
      expect(isNodeRunnable(createNodeState('pending'))).toBe(true)
    })

    it('should return true for ready status', () => {
      expect(isNodeRunnable(createNodeState('ready'))).toBe(true)
    })

    it('should return false for running status', () => {
      expect(isNodeRunnable(createNodeState('running'))).toBe(false)
    })

    it('should return false for done status', () => {
      expect(isNodeRunnable(createNodeState('done'))).toBe(false)
    })
  })
})

describe('节点列表查询', () => {
  describe('getActiveNodes', () => {
    it('should return nodes with running status', () => {
      const instance = createInstance({
        'task-1': createNodeState('running'),
        'task-2': createNodeState('pending'),
        'task-3': createNodeState('running'),
      })

      const active = getActiveNodes(instance)
      expect(active).toHaveLength(2)
      expect(active).toContain('task-1')
      expect(active).toContain('task-3')
    })

    it('should return empty array when no running nodes', () => {
      const instance = createInstance({
        'task-1': createNodeState('done'),
        'task-2': createNodeState('pending'),
      })

      expect(getActiveNodes(instance)).toHaveLength(0)
    })
  })

  describe('getPendingNodes', () => {
    it('should return nodes with pending or ready status', () => {
      const instance = createInstance({
        'task-1': createNodeState('pending'),
        'task-2': createNodeState('ready'),
        'task-3': createNodeState('running'),
        'task-4': createNodeState('done'),
      })

      const pending = getPendingNodes(instance)
      expect(pending).toHaveLength(2)
      expect(pending).toContain('task-1')
      expect(pending).toContain('task-2')
    })
  })

  describe('getCompletedNodes', () => {
    it('should return nodes with done or skipped status', () => {
      const instance = createInstance({
        'task-1': createNodeState('done'),
        'task-2': createNodeState('skipped'),
        'task-3': createNodeState('running'),
        'task-4': createNodeState('failed'),
      })

      const completed = getCompletedNodes(instance)
      expect(completed).toHaveLength(2)
      expect(completed).toContain('task-1')
      expect(completed).toContain('task-2')
    })
  })

  describe('getFailedNodes', () => {
    it('should return nodes with failed status', () => {
      const instance = createInstance({
        'task-1': createNodeState('done'),
        'task-2': createNodeState('failed'),
        'task-3': createNodeState('failed'),
      })

      const failed = getFailedNodes(instance)
      expect(failed).toHaveLength(2)
      expect(failed).toContain('task-2')
      expect(failed).toContain('task-3')
    })
  })
})

describe('工作流进度', () => {
  describe('getWorkflowProgress', () => {
    it('should calculate progress correctly', () => {
      const workflow = createWorkflow(4)
      const instance = createInstance({
        'start': createNodeState('done'),
        'task-1': createNodeState('done'),
        'task-2': createNodeState('done'),
        'task-3': createNodeState('running'),
        'task-4': createNodeState('pending'),
        'end': createNodeState('pending'),
      })

      const progress = getWorkflowProgress(instance, workflow)

      expect(progress.total).toBe(4) // 排除 start 和 end
      expect(progress.completed).toBe(2)
      expect(progress.running).toBe(1)
      expect(progress.pending).toBe(1)
      expect(progress.failed).toBe(0)
      expect(progress.percentage).toBe(50)
    })

    it('should handle empty workflow', () => {
      const workflow = createWorkflow(0)
      const instance = createInstance({
        'start': createNodeState('done'),
        'end': createNodeState('pending'),
      })

      const progress = getWorkflowProgress(instance, workflow)
      expect(progress.total).toBe(0)
      expect(progress.percentage).toBe(0)
    })

    it('should count failed nodes', () => {
      const workflow = createWorkflow(3)
      const instance = createInstance({
        'start': createNodeState('done'),
        'task-1': createNodeState('done'),
        'task-2': createNodeState('failed', { error: 'Test error' }),
        'task-3': createNodeState('pending'),
        'end': createNodeState('pending'),
      })

      const progress = getWorkflowProgress(instance, workflow)
      expect(progress.failed).toBe(1)
      expect(progress.completed).toBe(1)
    })

    it('should count skipped as completed', () => {
      const workflow = createWorkflow(2)
      const instance = createInstance({
        'start': createNodeState('done'),
        'task-1': createNodeState('done'),
        'task-2': createNodeState('skipped'),
        'end': createNodeState('done'),
      })

      const progress = getWorkflowProgress(instance, workflow)
      expect(progress.completed).toBe(2)
      expect(progress.percentage).toBe(100)
    })
  })
})

describe('工作流完成检查', () => {
  describe('checkWorkflowCompletion', () => {
    it('should return completed when end node is done', () => {
      const workflow = createWorkflow(2)
      const instance = createInstance({
        'start': createNodeState('done'),
        'task-1': createNodeState('done'),
        'task-2': createNodeState('done'),
        'end': createNodeState('done'),
      })

      const result = checkWorkflowCompletion(instance, workflow)
      expect(result.completed).toBe(true)
      expect(result.failed).toBe(false)
    })

    it('should return not completed when end node is pending', () => {
      const workflow = createWorkflow(2)
      const instance = createInstance({
        'start': createNodeState('done'),
        'task-1': createNodeState('done'),
        'task-2': createNodeState('running'),
        'end': createNodeState('pending'),
      })

      const result = checkWorkflowCompletion(instance, workflow)
      expect(result.completed).toBe(false)
      expect(result.failed).toBe(false)
    })

    it('should return failed when node exceeds max retries', () => {
      const workflow = createWorkflow(2)
      // 设置默认重试次数为 3
      workflow.nodes.find(n => n.id === 'task-1')!.task!.retries = 3

      const instance = createInstance({
        'start': createNodeState('done'),
        'task-1': createNodeState('failed', {
          attempts: 3,
          error: 'Max retries exceeded',
        }),
        'task-2': createNodeState('pending'),
        'end': createNodeState('pending'),
      })

      const result = checkWorkflowCompletion(instance, workflow)
      expect(result.completed).toBe(false)
      expect(result.failed).toBe(true)
      expect(result.error).toContain('task-1')
      expect(result.error).toContain('3 attempts')
    })

    it('should not fail if retries not exhausted', () => {
      const workflow = createWorkflow(1)
      const instance = createInstance({
        'start': createNodeState('done'),
        'task-1': createNodeState('failed', {
          attempts: 1,
          error: 'Temporary error',
        }),
        'end': createNodeState('pending'),
      })

      const result = checkWorkflowCompletion(instance, workflow)
      expect(result.failed).toBe(false) // 还可以重试
    })
  })
})
