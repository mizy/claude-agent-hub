/**
 * WorkflowExecution 测试
 *
 * 覆盖:
 * - canExecuteNode: 节点可执行性判断
 * - getReadyNodes: 获取可执行节点列表
 * - checkWorkflowCompletion: 工作流完成检查
 * - getWorkflowProgress: 进度统计
 *
 * 注意：这些是 StateManager/WorkflowExecution 中导出的纯查询函数，
 * 不依赖 Store 文件 I/O，可以直接传入数据测试。
 */

import { describe, it, expect } from 'vitest'
import {
  isNodeCompleted,
  isNodeRunnable,
  getActiveNodes,
  getPendingNodes,
  getCompletedNodes,
  getFailedNodes,
  checkWorkflowCompletion,
  getWorkflowProgress,
} from '../src/workflow/engine/StateManager.js'
import { canExecuteNode, getReadyNodes } from '../src/workflow/engine/WorkflowExecution.js'
import type { Workflow, WorkflowInstance, NodeState } from '../src/workflow/types.js'

// ============ Test Helpers ============

function makeWorkflow(nodes: Workflow['nodes'], edges: Workflow['edges']): Workflow {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    description: 'test',
    nodes,
    edges,
    variables: {},
    createdAt: '2025-01-01T00:00:00.000Z',
  }
}

function makeInstance(
  nodeStates: Record<string, NodeState>,
  overrides: Partial<WorkflowInstance> = {}
): WorkflowInstance {
  return {
    id: 'inst-1',
    workflowId: 'wf-1',
    status: 'running',
    nodeStates,
    variables: {},
    outputs: {},
    loopCounts: {},
    ...overrides,
  }
}

function ns(status: NodeState['status'], overrides: Partial<NodeState> = {}): NodeState {
  return { status, attempts: status === 'pending' ? 0 : 1, ...overrides }
}

// ============ State query functions ============

describe('StateManager query functions', () => {
  describe('isNodeCompleted', () => {
    it('should return true for done', () => {
      expect(isNodeCompleted(ns('done'))).toBe(true)
    })

    it('should return true for skipped', () => {
      expect(isNodeCompleted(ns('skipped'))).toBe(true)
    })

    it('should return false for other statuses', () => {
      expect(isNodeCompleted(ns('pending'))).toBe(false)
      expect(isNodeCompleted(ns('running'))).toBe(false)
      expect(isNodeCompleted(ns('failed'))).toBe(false)
    })
  })

  describe('isNodeRunnable', () => {
    it('should return true for pending and ready', () => {
      expect(isNodeRunnable(ns('pending'))).toBe(true)
      expect(isNodeRunnable(ns('ready'))).toBe(true)
    })

    it('should return false for other statuses', () => {
      expect(isNodeRunnable(ns('running'))).toBe(false)
      expect(isNodeRunnable(ns('done'))).toBe(false)
    })
  })

  describe('getActiveNodes', () => {
    it('should return nodes with running status', () => {
      const instance = makeInstance({
        a: ns('running'),
        b: ns('done'),
        c: ns('running'),
        d: ns('pending'),
      })
      expect(getActiveNodes(instance)).toEqual(['a', 'c'])
    })

    it('should return empty for no running nodes', () => {
      const instance = makeInstance({
        a: ns('done'),
        b: ns('pending'),
      })
      expect(getActiveNodes(instance)).toEqual([])
    })
  })

  describe('getPendingNodes', () => {
    it('should return pending and ready nodes', () => {
      const instance = makeInstance({
        a: ns('pending'),
        b: ns('ready'),
        c: ns('running'),
        d: ns('done'),
      })
      expect(getPendingNodes(instance)).toEqual(['a', 'b'])
    })
  })

  describe('getCompletedNodes', () => {
    it('should return done and skipped nodes', () => {
      const instance = makeInstance({
        a: ns('done'),
        b: ns('skipped'),
        c: ns('running'),
      })
      expect(getCompletedNodes(instance)).toEqual(['a', 'b'])
    })
  })

  describe('getFailedNodes', () => {
    it('should return failed nodes', () => {
      const instance = makeInstance({
        a: ns('done'),
        b: ns('failed'),
        c: ns('failed'),
      })
      expect(getFailedNodes(instance)).toEqual(['b', 'c'])
    })
  })
})

// ============ checkWorkflowCompletion ============

describe('checkWorkflowCompletion', () => {
  it('should detect completed workflow when end node is done', () => {
    const workflow = makeWorkflow(
      [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'task1', type: 'task', name: 'Task 1', task: { persona: 'coder', prompt: 'do' } },
        { id: 'end', type: 'end', name: 'End' },
      ],
      [
        { id: 'e1', from: 'start', to: 'task1' },
        { id: 'e2', from: 'task1', to: 'end' },
      ]
    )

    const instance = makeInstance({
      start: ns('done'),
      task1: ns('done'),
      end: ns('done'),
    })

    const result = checkWorkflowCompletion(instance, workflow)
    expect(result.completed).toBe(true)
    expect(result.failed).toBe(false)
  })

  it('should return not completed when end node is not done', () => {
    const workflow = makeWorkflow(
      [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'task1', type: 'task', name: 'Task 1', task: { persona: 'coder', prompt: 'do' } },
        { id: 'end', type: 'end', name: 'End' },
      ],
      [
        { id: 'e1', from: 'start', to: 'task1' },
        { id: 'e2', from: 'task1', to: 'end' },
      ]
    )

    const instance = makeInstance({
      start: ns('done'),
      task1: ns('running'),
      end: ns('pending'),
    })

    const result = checkWorkflowCompletion(instance, workflow)
    expect(result.completed).toBe(false)
    expect(result.failed).toBe(false)
  })

  it('should detect failed workflow when node exceeds max retries', () => {
    const workflow = makeWorkflow(
      [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'task1', type: 'task', name: 'Task 1', task: { persona: 'coder', prompt: 'do', retries: 2 } },
        { id: 'end', type: 'end', name: 'End' },
      ],
      [
        { id: 'e1', from: 'start', to: 'task1' },
        { id: 'e2', from: 'task1', to: 'end' },
      ]
    )

    const instance = makeInstance({
      start: ns('done'),
      task1: ns('failed', { attempts: 2, error: 'timeout' }),
      end: ns('pending'),
    })

    const result = checkWorkflowCompletion(instance, workflow)
    expect(result.failed).toBe(true)
    expect(result.error).toContain('task1')
    expect(result.error).toContain('timeout')
  })

  it('should not fail if retries not exhausted', () => {
    const workflow = makeWorkflow(
      [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'task1', type: 'task', name: 'Task 1', task: { persona: 'coder', prompt: 'do', retries: 5 } },
        { id: 'end', type: 'end', name: 'End' },
      ],
      [
        { id: 'e1', from: 'start', to: 'task1' },
        { id: 'e2', from: 'task1', to: 'end' },
      ]
    )

    const instance = makeInstance({
      start: ns('done'),
      task1: ns('failed', { attempts: 2, error: 'transient' }),
      end: ns('pending'),
    })

    const result = checkWorkflowCompletion(instance, workflow)
    expect(result.failed).toBe(false)
  })

  it('should return not completed if no end node', () => {
    const workflow = makeWorkflow(
      [{ id: 'start', type: 'start', name: 'Start' }],
      []
    )

    const instance = makeInstance({ start: ns('done') })

    const result = checkWorkflowCompletion(instance, workflow)
    expect(result.completed).toBe(false)
    expect(result.failed).toBe(false)
  })
})

// ============ getWorkflowProgress ============

describe('getWorkflowProgress', () => {
  const workflow = makeWorkflow(
    [
      { id: 'start', type: 'start', name: 'Start' },
      { id: 'task1', type: 'task', name: 'T1', task: { persona: 'c', prompt: 'p' } },
      { id: 'task2', type: 'task', name: 'T2', task: { persona: 'c', prompt: 'p' } },
      { id: 'task3', type: 'task', name: 'T3', task: { persona: 'c', prompt: 'p' } },
      { id: 'end', type: 'end', name: 'End' },
    ],
    []
  )

  it('should exclude start and end from count', () => {
    const instance = makeInstance({
      start: ns('done'),
      task1: ns('pending'),
      task2: ns('pending'),
      task3: ns('pending'),
      end: ns('pending'),
    })

    const progress = getWorkflowProgress(instance, workflow)
    expect(progress.total).toBe(3) // Only task nodes
  })

  it('should calculate progress correctly', () => {
    const instance = makeInstance({
      start: ns('done'),
      task1: ns('done'),
      task2: ns('running'),
      task3: ns('pending'),
      end: ns('pending'),
    })

    const progress = getWorkflowProgress(instance, workflow)
    expect(progress.total).toBe(3)
    expect(progress.completed).toBe(1)
    expect(progress.running).toBe(1)
    expect(progress.pending).toBe(1)
    expect(progress.failed).toBe(0)
    expect(progress.percentage).toBe(33) // 1/3 ≈ 33%
  })

  it('should count skipped as completed', () => {
    const instance = makeInstance({
      start: ns('done'),
      task1: ns('done'),
      task2: ns('skipped'),
      task3: ns('done'),
      end: ns('done'),
    })

    const progress = getWorkflowProgress(instance, workflow)
    expect(progress.completed).toBe(3)
    expect(progress.percentage).toBe(100)
  })

  it('should count failed nodes', () => {
    const instance = makeInstance({
      start: ns('done'),
      task1: ns('done'),
      task2: ns('failed'),
      task3: ns('pending'),
      end: ns('pending'),
    })

    const progress = getWorkflowProgress(instance, workflow)
    expect(progress.failed).toBe(1)
  })

  it('should handle workflow with no task nodes', () => {
    const emptyWorkflow = makeWorkflow(
      [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'end', type: 'end', name: 'End' },
      ],
      []
    )

    const instance = makeInstance({ start: ns('done'), end: ns('done') })

    const progress = getWorkflowProgress(instance, emptyWorkflow)
    expect(progress.total).toBe(0)
    expect(progress.percentage).toBe(0)
  })
})

// ============ canExecuteNode ============

describe('canExecuteNode', () => {
  it('should always allow start node', () => {
    const workflow = makeWorkflow(
      [{ id: 'start', type: 'start', name: 'Start' }],
      []
    )
    const instance = makeInstance({ start: ns('pending') })

    expect(canExecuteNode('start', workflow, instance)).toBe(true)
  })

  it('should allow node when upstream is done', () => {
    const workflow = makeWorkflow(
      [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'task1', type: 'task', name: 'T1', task: { persona: 'c', prompt: 'p' } },
      ],
      [{ id: 'e1', from: 'start', to: 'task1' }]
    )
    const instance = makeInstance({
      start: ns('done'),
      task1: ns('pending'),
    })

    expect(canExecuteNode('task1', workflow, instance)).toBe(true)
  })

  it('should block node when upstream is not done', () => {
    const workflow = makeWorkflow(
      [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'task1', type: 'task', name: 'T1', task: { persona: 'c', prompt: 'p' } },
      ],
      [{ id: 'e1', from: 'start', to: 'task1' }]
    )
    const instance = makeInstance({
      start: ns('pending'),
      task1: ns('pending'),
    })

    expect(canExecuteNode('task1', workflow, instance)).toBe(false)
  })

  it('should require ALL upstream for multi-edge node (AND logic)', () => {
    const workflow = makeWorkflow(
      [
        { id: 'a', type: 'task', name: 'A', task: { persona: 'c', prompt: 'p' } },
        { id: 'b', type: 'task', name: 'B', task: { persona: 'c', prompt: 'p' } },
        { id: 'c', type: 'task', name: 'C', task: { persona: 'c', prompt: 'p' } },
      ],
      [
        { id: 'e1', from: 'a', to: 'c' },
        { id: 'e2', from: 'b', to: 'c' },
      ]
    )
    const instance = makeInstance({
      a: ns('done'),
      b: ns('pending'), // b not done → c cannot execute
      c: ns('pending'),
    })

    expect(canExecuteNode('c', workflow, instance)).toBe(false)
  })

  it('should require ALL upstream for join node (AND logic)', () => {
    const workflow = makeWorkflow(
      [
        { id: 'a', type: 'task', name: 'A', task: { persona: 'c', prompt: 'p' } },
        { id: 'b', type: 'task', name: 'B', task: { persona: 'c', prompt: 'p' } },
        { id: 'join', type: 'join', name: 'Join' },
      ],
      [
        { id: 'e1', from: 'a', to: 'join' },
        { id: 'e2', from: 'b', to: 'join' },
      ]
    )

    // Only a is done → join cannot execute
    const instance1 = makeInstance({
      a: ns('done'),
      b: ns('pending'),
      join: ns('pending'),
    })
    expect(canExecuteNode('join', workflow, instance1)).toBe(false)

    // Both done → join can execute
    const instance2 = makeInstance({
      a: ns('done'),
      b: ns('done'),
      join: ns('pending'),
    })
    expect(canExecuteNode('join', workflow, instance2)).toBe(true)
  })

  it('should accept skipped upstream as completed', () => {
    const workflow = makeWorkflow(
      [
        { id: 'a', type: 'task', name: 'A', task: { persona: 'c', prompt: 'p' } },
        { id: 'b', type: 'task', name: 'B', task: { persona: 'c', prompt: 'p' } },
      ],
      [{ id: 'e1', from: 'a', to: 'b' }]
    )
    const instance = makeInstance({
      a: ns('skipped'),
      b: ns('pending'),
    })

    expect(canExecuteNode('b', workflow, instance)).toBe(true)
  })

  it('should return false for unknown node', () => {
    const workflow = makeWorkflow([], [])
    const instance = makeInstance({})

    expect(canExecuteNode('nonexistent', workflow, instance)).toBe(false)
  })
})

// ============ getReadyNodes ============

describe('getReadyNodes', () => {
  it('should return nodes that are pending and have completed upstream', () => {
    const workflow = makeWorkflow(
      [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'task1', type: 'task', name: 'T1', task: { persona: 'c', prompt: 'p' } },
        { id: 'task2', type: 'task', name: 'T2', task: { persona: 'c', prompt: 'p' } },
        { id: 'end', type: 'end', name: 'End' },
      ],
      [
        { id: 'e1', from: 'start', to: 'task1' },
        { id: 'e2', from: 'start', to: 'task2' },
        { id: 'e3', from: 'task1', to: 'end' },
        { id: 'e4', from: 'task2', to: 'end' },
      ]
    )

    const instance = makeInstance({
      start: ns('done'),
      task1: ns('pending'),
      task2: ns('pending'),
      end: ns('pending'),
    })

    const ready = getReadyNodes(workflow, instance)
    expect(ready).toContain('task1')
    expect(ready).toContain('task2')
    expect(ready).not.toContain('end') // end's upstream not done
    expect(ready).not.toContain('start') // start already done
  })

  it('should not include running or done nodes', () => {
    const workflow = makeWorkflow(
      [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'task1', type: 'task', name: 'T1', task: { persona: 'c', prompt: 'p' } },
      ],
      [{ id: 'e1', from: 'start', to: 'task1' }]
    )

    const instance = makeInstance({
      start: ns('done'),
      task1: ns('running'),
    })

    expect(getReadyNodes(workflow, instance)).toEqual([])
  })

  it('should include ready status nodes', () => {
    const workflow = makeWorkflow(
      [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'task1', type: 'task', name: 'T1', task: { persona: 'c', prompt: 'p' } },
      ],
      [{ id: 'e1', from: 'start', to: 'task1' }]
    )

    const instance = makeInstance({
      start: ns('done'),
      task1: ns('ready'),
    })

    expect(getReadyNodes(workflow, instance)).toContain('task1')
  })

  it('should return empty when no nodes are ready', () => {
    const workflow = makeWorkflow(
      [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'task1', type: 'task', name: 'T1', task: { persona: 'c', prompt: 'p' } },
      ],
      [{ id: 'e1', from: 'start', to: 'task1' }]
    )

    const instance = makeInstance({
      start: ns('pending'),
      task1: ns('pending'),
    })

    // start is always executable, but it's pending so it should be in the list
    const ready = getReadyNodes(workflow, instance)
    expect(ready).toContain('start')
    expect(ready).not.toContain('task1')
  })
})
