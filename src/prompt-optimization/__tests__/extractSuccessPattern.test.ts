import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractSuccessPatterns, findMatchingPattern, type SuccessPattern } from '../extractSuccessPattern.js'
import type { Task } from '../../types/task.js'

// Mock stores
vi.mock('../../store/TaskWorkflowStore.js', () => ({
  getTaskWorkflow: vi.fn(),
  getTaskInstance: vi.fn(),
}))

import { getTaskWorkflow, getTaskInstance } from '../../store/TaskWorkflowStore.js'

const mockGetWorkflow = vi.mocked(getTaskWorkflow)
const mockGetInstance = vi.mocked(getTaskInstance)

function makeTask(id: string, status: 'completed' | 'failed' = 'completed'): Task {
  return {
    id,
    title: `Task ${id}`,
    description: `Desc ${id}`,
    priority: 'medium',
    status,
    retryCount: 0,
    createdAt: new Date().toISOString(),
  }
}

function makeWorkflow(nodes: Array<{ id: string; name: string; type: string; persona?: string }>) {
  return {
    id: 'wf-1',
    name: 'Test',
    description: 'Test',
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.type as 'start' | 'end' | 'task',
      name: n.name,
      ...(n.persona ? { task: { persona: n.persona, prompt: 'do it' } } : {}),
    })),
    edges: [],
    variables: {},
    createdAt: new Date().toISOString(),
  }
}

function makeInstance(status: 'completed' | 'failed' = 'completed', durationMs = 60000) {
  const start = new Date('2025-01-01T00:00:00Z')
  const end = new Date(start.getTime() + durationMs)
  return {
    id: 'inst-1',
    workflowId: 'wf-1',
    status,
    nodeStates: {},
    variables: {},
    outputs: {},
    loopCounts: {},
    startedAt: start.toISOString(),
    completedAt: end.toISOString(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extractSuccessPatterns', () => {
  it('returns empty array for empty task list', () => {
    const result = extractSuccessPatterns([])
    expect(result).toEqual([])
  })

  it('returns empty array when no completed tasks', () => {
    const result = extractSuccessPatterns([makeTask('t1', 'failed')])
    expect(result).toEqual([])
  })

  it('extracts correct node sequence ignoring start/end', () => {
    const task = makeTask('t1')
    mockGetWorkflow.mockReturnValue(
      makeWorkflow([
        { id: 'start', name: 'Start', type: 'start' },
        { id: 'n1', name: '分析代码', type: 'task', persona: 'Analyst' },
        { id: 'n2', name: '实现功能', type: 'task', persona: 'Pragmatist' },
        { id: 'end', name: 'End', type: 'end' },
      ]) as any
    )
    mockGetInstance.mockReturnValue(makeInstance('completed', 120000) as any)

    const result = extractSuccessPatterns([task])
    expect(result).toHaveLength(1)
    expect(result[0]!.nodeSequence).toEqual(['分析代码', '实现功能'])
    expect(result[0]!.agentAssignments).toEqual({ n1: 'Analyst', n2: 'Pragmatist' })
    expect(result[0]!.avgDuration).toBe(120000)
    expect(result[0]!.sampleCount).toBe(1)
  })

  it('clusters similar sequences together', () => {
    const tasks = [makeTask('t1'), makeTask('t2')]

    // Same sequence for both tasks
    mockGetWorkflow.mockImplementation((_taskId: string) =>
      makeWorkflow([
        { id: 'start', name: 'Start', type: 'start' },
        { id: 'n1', name: '分析', type: 'task', persona: 'A' },
        { id: 'n2', name: '实现', type: 'task', persona: 'B' },
        { id: 'end', name: 'End', type: 'end' },
      ]) as any
    )
    mockGetInstance.mockReturnValueOnce(makeInstance('completed', 60000) as any)
    mockGetInstance.mockReturnValueOnce(makeInstance('completed', 80000) as any)

    const result = extractSuccessPatterns(tasks)
    expect(result).toHaveLength(1)
    expect(result[0]!.sampleCount).toBe(2)
    expect(result[0]!.avgDuration).toBe(70000) // (60k + 80k) / 2
  })

  it('computes confidence based on sampleCount', () => {
    // 1 sample → 0.2
    const tasks1 = [makeTask('t1')]
    mockGetWorkflow.mockReturnValue(
      makeWorkflow([
        { id: 'n1', name: 'A', type: 'task', persona: 'X' },
      ]) as any
    )
    mockGetInstance.mockReturnValue(makeInstance() as any)

    const r1 = extractSuccessPatterns(tasks1)
    expect(r1[0]!.confidence).toBe(0.2) // 1/5

    // 5+ samples → 1.0
    vi.clearAllMocks()
    const tasks5 = Array.from({ length: 6 }, (_, i) => makeTask(`t${i}`))
    mockGetWorkflow.mockReturnValue(
      makeWorkflow([{ id: 'n1', name: 'A', type: 'task', persona: 'X' }]) as any
    )
    mockGetInstance.mockReturnValue(makeInstance() as any)

    const r2 = extractSuccessPatterns(tasks5)
    expect(r2[0]!.confidence).toBe(1)
  })

  it('separates different sequences into different patterns', () => {
    const tasks = [makeTask('t1'), makeTask('t2')]

    mockGetWorkflow.mockReturnValueOnce(
      makeWorkflow([
        { id: 'n1', name: 'A', type: 'task', persona: 'X' },
        { id: 'n2', name: 'B', type: 'task', persona: 'Y' },
      ]) as any
    )
    mockGetWorkflow.mockReturnValueOnce(
      makeWorkflow([
        { id: 'n1', name: 'X', type: 'task', persona: 'A' },
        { id: 'n2', name: 'Y', type: 'task', persona: 'B' },
        { id: 'n3', name: 'Z', type: 'task', persona: 'C' },
      ]) as any
    )
    mockGetInstance.mockReturnValue(makeInstance() as any)

    const result = extractSuccessPatterns(tasks)
    expect(result).toHaveLength(2)
  })
})

describe('findMatchingPattern', () => {
  const patterns: SuccessPattern[] = [
    {
      id: 'sp-1',
      taskType: 'testing',
      nodeSequence: ['写单元测试', '运行测试'],
      agentAssignments: {},
      avgDuration: 60000,
      sampleCount: 5,
      confidence: 1,
      extractedAt: new Date().toISOString(),
    },
    {
      id: 'sp-2',
      taskType: 'feature',
      nodeSequence: ['分析代码', '实现功能', '运行测试'],
      agentAssignments: {},
      avgDuration: 120000,
      sampleCount: 3,
      confidence: 0.6,
      extractedAt: new Date().toISOString(),
    },
  ]

  it('returns null for empty patterns', () => {
    expect(findMatchingPattern('anything', [])).toBeNull()
  })

  it('returns null when no keywords match', () => {
    expect(findMatchingPattern('xyz abc', patterns)).toBeNull()
  })

  it('returns best matching pattern', () => {
    const result = findMatchingPattern('写单元测试', patterns)
    expect(result?.id).toBe('sp-1')
  })

  it('weights by confidence', () => {
    // "测试" matches both, but sp-1 has higher confidence
    const result = findMatchingPattern('运行测试', patterns)
    expect(result?.id).toBe('sp-1')
  })
})
