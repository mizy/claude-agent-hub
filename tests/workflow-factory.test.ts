/**
 * Workflow 类型工厂函数测试
 *
 * 覆盖:
 * - WORKFLOW_FACTORY 方法
 * - createInitialInstance: 初始实例创建
 * - createInitialNodeState: 初始节点状态
 */

import { describe, it, expect } from 'vitest'
import {
  WORKFLOW_FACTORY,
  createWorkflow,
  createTaskNode,
  createHumanNode,
  createEdge,
  createInitialNodeState,
  createInitialInstance,
} from '../src/workflow/types.js'
import type { Workflow } from '../src/workflow/types.js'

describe('WORKFLOW_FACTORY', () => {
  it('should expose all factory functions', () => {
    expect(WORKFLOW_FACTORY.createWorkflow).toBe(createWorkflow)
    expect(WORKFLOW_FACTORY.createTaskNode).toBe(createTaskNode)
    expect(WORKFLOW_FACTORY.createHumanNode).toBe(createHumanNode)
    expect(WORKFLOW_FACTORY.createEdge).toBe(createEdge)
    expect(WORKFLOW_FACTORY.createInitialNodeState).toBe(createInitialNodeState)
    expect(WORKFLOW_FACTORY.createInitialInstance).toBe(createInitialInstance)
  })
})

describe('createWorkflow', () => {
  it('should create workflow with basic fields', () => {
    const wf = createWorkflow('My Workflow', 'A test workflow', [], [])

    expect(wf.name).toBe('My Workflow')
    expect(wf.description).toBe('A test workflow')
    expect(wf.nodes).toEqual([])
    expect(wf.edges).toEqual([])
    expect(wf.variables).toEqual({})
  })

  it('should include provided nodes and edges', () => {
    const nodes = [{ id: 'start', type: 'start' as const, name: 'Start' }]
    const edges = [{ id: 'e1', from: 'start', to: 'end' }]

    const wf = createWorkflow('WF', 'desc', nodes, edges)

    expect(wf.nodes).toHaveLength(1)
    expect(wf.edges).toHaveLength(1)
  })
})

describe('createTaskNode', () => {
  it('should create a task node', () => {
    const node = createTaskNode('task-1', 'Build Feature', {
      persona: 'coder',
      prompt: 'Write the code',
    })

    expect(node.id).toBe('task-1')
    expect(node.type).toBe('task')
    expect(node.name).toBe('Build Feature')
    expect(node.task?.persona).toBe('coder')
    expect(node.task?.prompt).toBe('Write the code')
  })

  it('should include optional task config fields', () => {
    const node = createTaskNode('t-2', 'Review', {
      persona: 'reviewer',
      prompt: 'Review the code',
      timeout: 60000,
      retries: 5,
    })

    expect(node.task?.timeout).toBe(60000)
    expect(node.task?.retries).toBe(5)
  })
})

describe('createHumanNode', () => {
  it('should create a human node without config', () => {
    const node = createHumanNode('human-1', 'Approval')

    expect(node.id).toBe('human-1')
    expect(node.type).toBe('human')
    expect(node.name).toBe('Approval')
    expect(node.human).toBeUndefined()
  })

  it('should create a human node with config', () => {
    const node = createHumanNode('human-2', 'Manual Check', {
      assignee: 'admin',
      timeout: 300000,
      autoApprove: true,
    })

    expect(node.human?.assignee).toBe('admin')
    expect(node.human?.timeout).toBe(300000)
    expect(node.human?.autoApprove).toBe(true)
  })
})

describe('createEdge', () => {
  it('should create a basic edge', () => {
    const edge = createEdge('a', 'b')

    expect(edge.from).toBe('a')
    expect(edge.to).toBe('b')
    expect(edge.condition).toBeUndefined()
    expect(edge.maxLoops).toBeUndefined()
  })

  it('should create edge with condition', () => {
    const edge = createEdge('a', 'b', { condition: 'x > 5' })

    expect(edge.condition).toBe('x > 5')
  })

  it('should create edge with maxLoops', () => {
    const edge = createEdge('a', 'b', { maxLoops: 3 })

    expect(edge.maxLoops).toBe(3)
  })

  it('should create edge with label', () => {
    const edge = createEdge('a', 'b', { label: 'success' })

    expect(edge.label).toBe('success')
  })
})

describe('createInitialNodeState', () => {
  it('should create pending state with 0 attempts', () => {
    const state = createInitialNodeState()

    expect(state.status).toBe('pending')
    expect(state.attempts).toBe(0)
    expect(state.startedAt).toBeUndefined()
    expect(state.completedAt).toBeUndefined()
    expect(state.error).toBeUndefined()
  })
})

describe('createInitialInstance', () => {
  it('should create instance with pending status', () => {
    const workflow: Workflow = {
      id: 'wf-1',
      name: 'Test',
      description: 'test',
      nodes: [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'task1', type: 'task', name: 'Task 1', task: { persona: 'c', prompt: 'p' } },
        { id: 'end', type: 'end', name: 'End' },
      ],
      edges: [],
      variables: { key: 'value' },
      createdAt: '2025-01-01T00:00:00.000Z',
    }

    const instance = createInitialInstance('wf-1', workflow)

    expect(instance.workflowId).toBe('wf-1')
    expect(instance.status).toBe('pending')
    expect(instance.loopCounts).toEqual({})
    expect(instance.outputs).toEqual({})

    // Should have nodeStates for each node
    expect(instance.nodeStates).toHaveProperty('start')
    expect(instance.nodeStates).toHaveProperty('task1')
    expect(instance.nodeStates).toHaveProperty('end')

    // Each node should be pending
    expect(instance.nodeStates['start']?.status).toBe('pending')
    expect(instance.nodeStates['task1']?.status).toBe('pending')
    expect(instance.nodeStates['end']?.status).toBe('pending')
  })

  it('should copy workflow variables', () => {
    const workflow: Workflow = {
      id: 'wf-1',
      name: 'Test',
      description: 'test',
      nodes: [],
      edges: [],
      variables: { count: 10, name: 'test' },
      createdAt: '2025-01-01T00:00:00.000Z',
    }

    const instance = createInitialInstance('wf-1', workflow)

    expect(instance.variables).toEqual({ count: 10, name: 'test' })
  })

  it('should not share variable reference with workflow', () => {
    const variables = { mutable: true }
    const workflow: Workflow = {
      id: 'wf-1',
      name: 'Test',
      description: 'test',
      nodes: [],
      edges: [],
      variables,
      createdAt: '2025-01-01T00:00:00.000Z',
    }

    const instance = createInitialInstance('wf-1', workflow)

    // Mutating workflow variables should not affect instance
    variables.mutable = false
    expect(instance.variables.mutable).toBe(true)
  })
})
