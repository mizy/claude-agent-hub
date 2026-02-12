import { describe, it, expect } from 'vitest'
import {
  createWorkflow,
  createTaskNode,
  createHumanNode,
  createEdge,
  createInitialNodeState,
  createInitialInstance,
  WORKFLOW_FACTORY,
} from '../factory.js'

describe('workflow factory', () => {
  it('createWorkflow returns correct structure', () => {
    const nodes = [{ id: 'start', type: 'start' as const, name: 'Start' }]
    const edges = [{ id: 'e1', from: 'start', to: 'end' }]
    const wf = createWorkflow('test', 'desc', nodes, edges)
    expect(wf.name).toBe('test')
    expect(wf.description).toBe('desc')
    expect(wf.nodes).toBe(nodes)
    expect(wf.edges).toBe(edges)
    expect(wf.variables).toEqual({})
  })

  it('createTaskNode returns task-type node', () => {
    const node = createTaskNode('n1', 'Code', { persona: 'coder', prompt: 'do stuff' })
    expect(node.id).toBe('n1')
    expect(node.type).toBe('task')
    expect(node.name).toBe('Code')
    expect(node.task?.persona).toBe('coder')
  })

  it('createHumanNode returns human-type node', () => {
    const node = createHumanNode('h1', 'Review', { assignee: 'alice' })
    expect(node.type).toBe('human')
    expect(node.human?.assignee).toBe('alice')
  })

  it('createEdge returns edge without id', () => {
    const edge = createEdge('a', 'b', { condition: 'x > 1' })
    expect(edge.from).toBe('a')
    expect(edge.to).toBe('b')
    expect(edge.condition).toBe('x > 1')
  })

  it('createInitialNodeState returns pending with 0 attempts', () => {
    const state = createInitialNodeState()
    expect(state.status).toBe('pending')
    expect(state.attempts).toBe(0)
  })

  it('createInitialInstance initializes all node states', () => {
    const workflow = {
      id: 'w1',
      name: 'test',
      description: '',
      nodes: [
        { id: 'start', type: 'start' as const, name: 'Start' },
        { id: 'n1', type: 'task' as const, name: 'Task' },
        { id: 'end', type: 'end' as const, name: 'End' },
      ],
      edges: [],
      variables: { foo: 'bar' },
      createdAt: new Date().toISOString(),
    }
    const instance = createInitialInstance('w1', workflow)
    expect(instance.workflowId).toBe('w1')
    expect(instance.status).toBe('pending')
    expect(Object.keys(instance.nodeStates)).toHaveLength(3)
    expect(instance.nodeStates['n1']?.status).toBe('pending')
    expect(instance.variables).toEqual({ foo: 'bar' })
    expect(instance.outputs).toEqual({})
    expect(instance.loopCounts).toEqual({})
  })

  it('WORKFLOW_FACTORY aggregates all functions', () => {
    expect(WORKFLOW_FACTORY.createWorkflow).toBe(createWorkflow)
    expect(WORKFLOW_FACTORY.createTaskNode).toBe(createTaskNode)
    expect(WORKFLOW_FACTORY.createHumanNode).toBe(createHumanNode)
    expect(WORKFLOW_FACTORY.createEdge).toBe(createEdge)
    expect(WORKFLOW_FACTORY.createInitialNodeState).toBe(createInitialNodeState)
    expect(WORKFLOW_FACTORY.createInitialInstance).toBe(createInitialInstance)
  })
})
