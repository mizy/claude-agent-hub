import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing the module under test
vi.mock('../../store/TaskStore.js', () => ({
  getTasksByStatus: vi.fn().mockReturnValue([]),
}))
vi.mock('../../store/TaskWorkflowStore.js', () => ({
  getTaskWorkflow: vi.fn().mockReturnValue(null),
  getTaskInstance: vi.fn().mockReturnValue(null),
}))
vi.mock('../../prompt-optimization/classifyFailure.js', () => ({
  classifyFailure: vi.fn().mockReturnValue({
    category: 'execution',
    confidence: 0.8,
    matchedPatterns: ['timeout'],
    raw: 'Command timed out',
  }),
}))
vi.mock('../../prompt-optimization/analyzeFailure.js', () => ({
  extractFailedNodes: vi.fn().mockReturnValue([{ nodeId: 'n1', nodeName: 'test', error: 'fail', attempts: 1 }]),
}))

import { analyzeRecentFailures, analyzeTaskPatterns } from '../analyzeTaskPatterns.js'
import { getTasksByStatus } from '../../store/TaskStore.js'
import { getTaskWorkflow, getTaskInstance } from '../../store/TaskWorkflowStore.js'
import { classifyFailure } from '../../prompt-optimization/classifyFailure.js'
import type { Task } from '../../types/task.js'
import type { Workflow, WorkflowInstance } from '../../types/workflow.js'

function makeTask(id: string, overrides?: Partial<Task>): Task {
  return {
    id,
    title: `Task ${id}`,
    prompt: 'test',
    status: 'failed',
    priority: 'medium',
    createdAt: new Date().toISOString(),
    error: 'Some error',
    ...overrides,
  } as Task
}

describe('analyzeRecentFailures (backward compat)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty result when no failed tasks', () => {
    vi.mocked(getTasksByStatus).mockReturnValue([])
    const result = analyzeRecentFailures()
    expect(result.totalExamined).toBe(0)
    expect(result.patterns).toHaveLength(0)
    expect(result.personaBreakdown).toEqual({})
  })

  it('analyzes failed tasks and groups into patterns', () => {
    const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')]
    vi.mocked(getTasksByStatus).mockReturnValue(tasks)

    vi.mocked(getTaskWorkflow).mockReturnValue({
      nodes: [{ id: 'n1', type: 'task', task: { persona: 'Pragmatist' } }],
      edges: [],
    } as unknown as Workflow)
    vi.mocked(getTaskInstance).mockReturnValue({ nodeStates: {} } as unknown as WorkflowInstance)
    vi.mocked(classifyFailure).mockReturnValue({
      category: 'execution',
      confidence: 0.8,
      matchedPatterns: ['timeout'],
      raw: 'Command timed out',
    })

    const result = analyzeRecentFailures()
    expect(result.totalExamined).toBe(3)
    expect(result.patterns.length).toBeGreaterThan(0)
    expect(result.patterns[0]!.occurrences).toBe(3)
    expect(result.patterns[0]!.taskIds).toEqual(['t1', 't2', 't3'])
  })

  it('respects limit option', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => makeTask(`t${i}`))
    vi.mocked(getTasksByStatus).mockReturnValue(tasks)
    vi.mocked(getTaskWorkflow).mockReturnValue(null)

    const result = analyzeRecentFailures({ limit: 3 })
    expect(result.totalExamined).toBe(3)
  })

  it('filters by since date', () => {
    const old = makeTask('t-old', { createdAt: '2024-01-01T00:00:00Z' })
    const recent = makeTask('t-new', { createdAt: '2025-06-01T00:00:00Z' })
    vi.mocked(getTasksByStatus).mockReturnValue([old, recent])
    vi.mocked(getTaskWorkflow).mockReturnValue(null)

    const result = analyzeRecentFailures({ since: new Date('2025-01-01') })
    expect(result.totalExamined).toBe(1)
  })

  it('tracks persona breakdown', () => {
    const tasks = [makeTask('t1'), makeTask('t2')]
    vi.mocked(getTasksByStatus).mockReturnValue(tasks)
    vi.mocked(getTaskWorkflow).mockReturnValue({
      nodes: [{ id: 'n1', type: 'task', task: { persona: 'Architect' } }],
      edges: [],
    } as unknown as Workflow)
    vi.mocked(getTaskInstance).mockReturnValue({ nodeStates: {} } as unknown as WorkflowInstance)
    vi.mocked(classifyFailure).mockReturnValue({
      category: 'planning',
      confidence: 0.9,
      matchedPatterns: ['json'],
      raw: 'JSON parse error',
    })

    const result = analyzeRecentFailures()
    expect(result.personaBreakdown).toHaveProperty('Architect')
    expect(result.personaBreakdown['Architect']!.failures).toBe(2)
    expect(result.personaBreakdown['Architect']!.topCategory).toBe('planning')
  })

  it('handles tasks without workflow/instance gracefully', () => {
    const tasks = [makeTask('t1', { error: 'Unknown crash' })]
    vi.mocked(getTasksByStatus).mockReturnValue(tasks)
    vi.mocked(getTaskWorkflow).mockReturnValue(null)
    vi.mocked(getTaskInstance).mockReturnValue(null)

    const result = analyzeRecentFailures()
    expect(result.totalExamined).toBe(1)
    expect(result.patterns.length).toBeGreaterThan(0)
  })
})

describe('analyzeTaskPatterns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('analyzes both completed and failed tasks by default', () => {
    const failed = [makeTask('f1', { status: 'failed' })]
    const completed = [makeTask('c1', { status: 'completed' as Task['status'] })]
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'failed') return failed
      if (status === 'completed') return completed
      return []
    })
    vi.mocked(getTaskWorkflow).mockReturnValue(null)
    vi.mocked(getTaskInstance).mockReturnValue(null)

    const result = analyzeTaskPatterns()
    expect(result.totalExamined).toBe(2)
  })

  it('detects retry instability in completed tasks', () => {
    const completed = [makeTask('c1', { status: 'completed' as Task['status'], error: undefined })]
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'completed') return completed
      return []
    })
    vi.mocked(getTaskWorkflow).mockReturnValue({
      nodes: [{ id: 'n1', type: 'task', task: { persona: 'Pragmatist' } }],
      edges: [],
    } as unknown as Workflow)
    vi.mocked(getTaskInstance).mockReturnValue({
      nodeStates: {
        'node-1': { status: 'done', attempts: 3 },
        'node-2': { status: 'done', attempts: 1 },
      },
    } as unknown as WorkflowInstance)

    const result = analyzeTaskPatterns()
    expect(result.totalExamined).toBe(1)
    // Should detect the retry instability pattern
    const retryPattern = result.patterns.find(p => p.description.includes('retries'))
    expect(retryPattern).toBeDefined()
    expect(retryPattern!.taskIds).toContain('c1')
  })

  it('includes successes in persona breakdown', () => {
    const completed = [makeTask('c1', { status: 'completed' as Task['status'], error: undefined })]
    vi.mocked(getTasksByStatus).mockImplementation((status: string) => {
      if (status === 'completed') return completed
      return []
    })
    vi.mocked(getTaskWorkflow).mockReturnValue({
      nodes: [{ id: 'n1', type: 'task', task: { persona: 'Pragmatist' } }],
      edges: [],
    } as unknown as Workflow)
    vi.mocked(getTaskInstance).mockReturnValue({ nodeStates: {} } as unknown as WorkflowInstance)

    const result = analyzeTaskPatterns()
    expect(result.personaBreakdown['Pragmatist']?.successes).toBe(1)
    expect(result.personaBreakdown['Pragmatist']?.failures).toBe(0)
  })
})
