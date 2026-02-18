/**
 * analyzeFailure 测试
 *
 * 测试失败分析的 JSON 解析和 prompt 构建
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analyzeFailure } from '../analyzeFailure.js'
import type { Task } from '../../types/task.js'
import type { Workflow, WorkflowInstance } from '../../workflow/types.js'

// Mock backend
vi.mock('../../backend/index.js', () => ({
  invokeBackend: vi.fn(),
}))

import { invokeBackend } from '../../backend/index.js'

const mockInvoke = vi.mocked(invokeBackend)

type InvokeReturn = Awaited<ReturnType<typeof invokeBackend>>

function mockOkResponse(response: string): InvokeReturn {
  return {
    ok: true,
    value: { response },
  } as unknown as InvokeReturn
}

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-test-001',
    title: 'Test task',
    description: 'A test task for analysis',
    priority: 'medium',
    status: 'failed',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: 'wf-001',
    name: 'Test Workflow',
    description: 'Test workflow desc',
    taskId: 'task-test-001',
    nodes: [
      {
        id: 'node-1',
        name: 'Build Project',
        type: 'task',
        task: { persona: 'Pragmatist', prompt: 'Build it' },
      },
    ],
    edges: [],
    variables: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Workflow
}

function makeInstance(overrides?: Partial<WorkflowInstance>): WorkflowInstance {
  return {
    id: 'inst-001',
    workflowId: 'wf-001',
    status: 'failed',
    nodeStates: {
      'node-1': {
        status: 'failed',
        error: 'Build failed: module not found',
        attempts: 2,
      },
    },
    variables: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  } as WorkflowInstance
}

describe('analyzeFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when no failed nodes exist', async () => {
    const instance = makeInstance({
      nodeStates: {
        'node-1': { status: 'done' as const, attempts: 1 },
      },
    })

    const result = await analyzeFailure(makeTask(), makeWorkflow(), instance, 'pv-001')
    expect(result).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('should return FailureAnalysis when failure is prompt-related', async () => {
    mockInvoke.mockResolvedValue(mockOkResponse(JSON.stringify({
      category: 'prompt_unclear',
      rootCause: 'The prompt did not specify which module to build',
      suggestion: 'Add explicit module path to the prompt',
      isPromptRelated: true,
    })))

    const result = await analyzeFailure(makeTask(), makeWorkflow(), makeInstance(), 'pv-001')

    expect(result).not.toBeNull()
    expect(result!.taskId).toBe('task-test-001')
    expect(result!.personaName).toBe('Pragmatist')
    expect(result!.versionId).toBe('pv-001')
    expect(result!.rootCause).toContain('prompt_unclear')
    expect(result!.failedNodes).toHaveLength(1)
    expect(result!.failedNodes[0]!.nodeId).toBe('node-1')
  })

  it('should return null when failure is not prompt-related', async () => {
    mockInvoke.mockResolvedValue(mockOkResponse(JSON.stringify({
      category: 'other',
      rootCause: 'Network timeout',
      suggestion: 'Retry',
      isPromptRelated: false,
    })))

    const result = await analyzeFailure(makeTask(), makeWorkflow(), makeInstance(), 'pv-001')
    expect(result).toBeNull()
  })

  it('should return null when backend call fails', async () => {
    mockInvoke.mockResolvedValue({
      ok: false,
      error: { message: 'Backend unavailable' },
    } as unknown as InvokeReturn)

    const result = await analyzeFailure(makeTask(), makeWorkflow(), makeInstance(), 'pv-001')
    expect(result).toBeNull()
  })

  it('should return null when response is not valid JSON', async () => {
    mockInvoke.mockResolvedValue(mockOkResponse('This is not JSON'))

    const result = await analyzeFailure(makeTask(), makeWorkflow(), makeInstance(), 'pv-001')
    expect(result).toBeNull()
  })

  it('should handle JSON wrapped in markdown code blocks', async () => {
    mockInvoke.mockResolvedValue(mockOkResponse(
      '```json\n' + JSON.stringify({
        category: 'context_insufficient',
        rootCause: 'Missing file paths',
        suggestion: 'Include project root in prompt',
        isPromptRelated: true,
      }) + '\n```'
    ))

    const result = await analyzeFailure(makeTask(), makeWorkflow(), makeInstance(), 'pv-001')
    expect(result).not.toBeNull()
    expect(result!.rootCause).toContain('context_insufficient')
  })

  it('should normalize invalid category to other', async () => {
    mockInvoke.mockResolvedValue(mockOkResponse(JSON.stringify({
      category: 'invalid_category',
      rootCause: 'Something',
      suggestion: 'Fix it',
      isPromptRelated: true,
    })))

    const result = await analyzeFailure(makeTask(), makeWorkflow(), makeInstance(), 'pv-001')
    // category normalized to 'other', but isPromptRelated=true so still returns result
    expect(result).not.toBeNull()
    expect(result!.rootCause).toContain('other')
  })
})
