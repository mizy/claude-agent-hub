import { describe, expect, it } from 'vitest'
import { workflowToSchema } from './workflowToSchema'
import type { WorkflowEdge, WorkflowNode, Instance } from '../store/useStore'

describe('workflowToSchema edge labels', () => {
  it('builds status-aware labels for condition branches', () => {
    const nodes: WorkflowNode[] = [
      { id: 'gate', name: 'Gate', type: 'condition' },
      { id: 'approved', name: 'Approved', type: 'task' },
      { id: 'rejected', name: 'Rejected', type: 'task' },
      { id: 'fallback', name: 'Fallback', type: 'task' },
    ]
    const edges: WorkflowEdge[] = [
      { id: 'approve', from: 'gate', to: 'approved', condition: 'approved' },
      { id: 'reject', from: 'gate', to: 'rejected', condition: '!approved' },
      { id: 'else', from: 'gate', to: 'fallback' },
    ]
    const instance: Instance = {
      nodeStates: {
        gate: { status: 'completed', attempts: 1 },
        approved: { status: 'completed', attempts: 1 },
        rejected: { status: 'failed', attempts: 1, error: 'Rejected' },
        fallback: { status: 'skipped', attempts: 0 },
      },
      outputs: {},
      variables: {},
      loopCounts: {},
    }

    const schema = workflowToSchema(nodes, edges, instance)
    const approveEdge = schema.lines.find(line => line.uuid === 'approve')
    const rejectEdge = schema.lines.find(line => line.uuid === 'reject')
    const elseEdge = schema.lines.find(line => line.uuid === 'else')

    expect(approveEdge).toMatchObject({
      label: 'if',
      labelKind: 'condition',
      status: 'completed',
    })
    expect(approveEdge?.className).toContain('ve-label-status-completed')

    expect(rejectEdge).toMatchObject({
      label: 'if not',
      labelKind: 'condition-negative',
      status: 'failed',
    })
    expect(rejectEdge?.className).toContain('ve-label-status-failed')

    expect(elseEdge).toMatchObject({
      label: 'else',
      labelKind: 'else',
      status: 'pending',
    })
    expect(elseEdge?.className).toContain('ve-label-status-pending')
  })

  it('builds loop labels for back edges', () => {
    const nodes: WorkflowNode[] = [
      { id: 'start', name: 'Start', type: 'task' },
      { id: 'retry', name: 'Retry', type: 'task' },
    ]
    const edges: WorkflowEdge[] = [
      { id: 'forward', from: 'start', to: 'retry' },
      { id: 'back', from: 'retry', to: 'start', maxLoops: 3 },
    ]
    const instance: Instance = {
      nodeStates: {
        start: { status: 'completed', attempts: 1 },
        retry: { status: 'completed', attempts: 1 },
      },
      outputs: {},
      variables: {},
      loopCounts: { back: 2 },
    }

    const schema = workflowToSchema(nodes, edges, instance)
    const backEdge = schema.lines.find(line => line.uuid === 'back')

    expect(backEdge).toMatchObject({
      label: 'loop 2/3',
      labelKind: 'loop',
      status: 'completed',
      isBackEdge: true,
    })
    expect(backEdge?.className).toContain('ve-back-edge')
    expect(backEdge?.className).toContain('ve-label-kind-loop')
  })
})
