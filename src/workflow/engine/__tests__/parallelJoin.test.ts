import { describe, it, expect } from 'vitest'
import { canExecuteNode } from '../WorkflowExecution.js'
import type { Workflow, WorkflowInstance } from '../../types.js'

/**
 * 构造最小 workflow 和 instance 用于测试 canExecuteNode
 */
function makeWorkflow(
  nodes: Array<{ id: string; type?: string; name?: string }>,
  edges: Array<{ from: string; to: string }>
): Workflow {
  return {
    id: 'w1',
    name: 'test',
    description: '',
    nodes: nodes.map(n => ({
      id: n.id,
      type: (n.type ?? 'task') as 'start' | 'end' | 'task',
      name: n.name ?? n.id,
    })),
    edges: edges.map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to })),
    variables: {},
    createdAt: '',
  }
}

type NodeStatus = 'pending' | 'ready' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped'

function makeInstance(
  nodeStates: Record<string, { status: NodeStatus; attempts?: number }>
): WorkflowInstance {
  const states: Record<string, { status: NodeStatus; attempts: number }> = {}
  for (const [id, s] of Object.entries(nodeStates)) {
    states[id] = { status: s.status, attempts: s.attempts ?? 0 }
  }
  return {
    id: 'inst1',
    workflowId: 'w1',
    status: 'running',
    nodeStates: states,
    variables: {},
    outputs: {},
    loopCounts: {},
  }
}

describe('canExecuteNode - parallel join', () => {
  // S → A → C (单入边，A 完成后 C 可执行)
  it('单入边节点：前置节点完成后可执行', () => {
    const wf = makeWorkflow(
      [{ id: 'S', type: 'start' }, { id: 'A' }, { id: 'C' }],
      [
        { from: 'S', to: 'A' },
        { from: 'A', to: 'C' },
      ]
    )
    const inst = makeInstance({
      S: { status: 'done' },
      A: { status: 'done' },
      C: { status: 'pending' },
    })
    expect(canExecuteNode('C', wf, inst)).toBe(true)
  })

  // S → A → C, S → B → C，A 完成但 B 未完成，C 不可执行
  it('并行汇聚点：部分前置完成时不可执行', () => {
    const wf = makeWorkflow(
      [{ id: 'S', type: 'start' }, { id: 'A' }, { id: 'B' }, { id: 'C' }],
      [
        { from: 'S', to: 'A' },
        { from: 'S', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'C' },
      ]
    )
    const inst = makeInstance({
      S: { status: 'done' },
      A: { status: 'done' },
      B: { status: 'running' },
      C: { status: 'pending' },
    })
    expect(canExecuteNode('C', wf, inst)).toBe(false)
  })

  // S → A → C, S → B → C，A 和 B 都完成，C 可执行
  it('并行汇聚点：所有前置完成后可执行', () => {
    const wf = makeWorkflow(
      [{ id: 'S', type: 'start' }, { id: 'A' }, { id: 'B' }, { id: 'C' }],
      [
        { from: 'S', to: 'A' },
        { from: 'S', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'C' },
      ]
    )
    const inst = makeInstance({
      S: { status: 'done' },
      A: { status: 'done' },
      B: { status: 'done' },
      C: { status: 'pending' },
    })
    expect(canExecuteNode('C', wf, inst)).toBe(true)
  })

  // S → A, S → B，分叉后各分支独立执行
  it('并行分叉：各分支独立可执行', () => {
    const wf = makeWorkflow(
      [{ id: 'S', type: 'start' }, { id: 'A' }, { id: 'B' }],
      [
        { from: 'S', to: 'A' },
        { from: 'S', to: 'B' },
      ]
    )
    const inst = makeInstance({
      S: { status: 'done' },
      A: { status: 'pending' },
      B: { status: 'pending' },
    })
    expect(canExecuteNode('A', wf, inst)).toBe(true)
    expect(canExecuteNode('B', wf, inst)).toBe(true)
  })
})
