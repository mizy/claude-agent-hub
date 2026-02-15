/**
 * Prompt optimization module tests
 *
 * Tests analyzeFailure, generateImprovement, manageVersions, and integration flow.
 * All backend calls are mocked to avoid real LLM invocations.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'

import { PROMPT_VERSIONS_DIR } from '../src/store/paths.js'
import {
  savePromptVersion,
  getPromptVersion,
  getAllVersions,
  getActiveVersion,
  generateVersionId,
} from '../src/store/PromptVersionStore.js'
import type { PromptVersion, FailureAnalysis } from '../src/types/promptVersion.js'
import type { Task } from '../src/types/task.js'
import type { Workflow, WorkflowInstance } from '../src/workflow/types.js'

// Mock invokeBackend for all tests in this file
vi.mock('../src/backend/index.js', () => ({
  invokeBackend: vi.fn(),
  buildPrompt: (prompt: string) => prompt,
}))

// Import after mock setup
import { invokeBackend } from '../src/backend/index.js'
import { analyzeFailure } from '../src/prompt-optimization/analyzeFailure.js'
import { generateImprovement } from '../src/prompt-optimization/generateImprovement.js'
import {
  saveNewVersion,
  getActivePrompt,
  rollbackVersion,
  recordUsage,
} from '../src/prompt-optimization/manageVersions.js'

const mockedInvoke = vi.mocked(invokeBackend)

// Test personas for cleanup
const testPersonas: string[] = []

function trackPersona(name: string): string {
  if (!testPersonas.includes(name)) testPersonas.push(name)
  return name
}

// Helpers
function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'Test Task',
    description: 'A test task for prompt optimization',
    priority: 'medium',
    status: 'failed',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function createMockWorkflow(personaName = 'Pragmatist'): Workflow {
  return {
    id: 'wf-test',
    name: 'Test Workflow',
    description: 'Test workflow',
    nodes: [
      { id: 'start', type: 'start', name: 'Start' },
      {
        id: 'node-1',
        type: 'task',
        name: 'Implement Feature',
        task: { persona: personaName, prompt: 'Do something' },
      },
      { id: 'end', type: 'end', name: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'node-1' },
      { id: 'e2', source: 'node-1', target: 'end' },
    ],
  }
}

function createMockInstance(failed = true): WorkflowInstance {
  return {
    id: 'inst-test',
    workflowId: 'wf-test',
    status: failed ? 'failed' : 'completed',
    nodeStates: failed
      ? {
          'node-1': {
            status: 'failed',
            error: 'Build failed: missing import statement',
            attempts: 3,
            startedAt: new Date().toISOString(),
          },
        }
      : {
          'node-1': {
            status: 'completed',
            attempts: 1,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        },
    variables: {},
    outputs: {},
    loopCounts: {},
    startedAt: new Date().toISOString(),
  }
}

function createMockVersion(
  persona: string,
  overrides: Partial<PromptVersion> = {}
): PromptVersion {
  return {
    id: generateVersionId(),
    personaName: persona,
    version: 1,
    systemPrompt: 'You are a pragmatic developer. Focus on simple solutions.',
    changelog: 'Initial version',
    stats: {
      totalTasks: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      avgDurationMs: 0,
    },
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

afterAll(() => {
  for (const persona of testPersonas) {
    const dir = join(PROMPT_VERSIONS_DIR, persona)
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

// ============================================================
// analyzeFailure tests
// ============================================================

describe('analyzeFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when no failed nodes exist', async () => {
    const task = createMockTask()
    const workflow = createMockWorkflow()
    const instance = createMockInstance(false) // completed, no failures

    const result = await analyzeFailure(task, workflow, instance, 'pv-test')
    expect(result).toBe(null)
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('should return FailureAnalysis for prompt-related failures', async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      value: {
        response: JSON.stringify({
          category: 'prompt_unclear',
          rootCause: 'The prompt did not specify which import to use',
          suggestion: 'Add explicit import path instructions',
          isPromptRelated: true,
        }),
        sessionId: 'test-session',
        durationApiMs: 1000,
        costUsd: 0.001,
      },
    } as any)

    const task = createMockTask()
    const workflow = createMockWorkflow()
    const instance = createMockInstance(true)

    const result = await analyzeFailure(task, workflow, instance, 'pv-test')

    expect(result).not.toBe(null)
    expect(result!.taskId).toBe(task.id)
    expect(result!.rootCause).toContain('prompt_unclear')
    expect(result!.suggestion).toBe('Add explicit import path instructions')
    expect(result!.failedNodes).toHaveLength(1)
    expect(result!.failedNodes[0]!.nodeName).toBe('Implement Feature')
    expect(result!.analyzedAt).toBeDefined()

    // Should have called backend with haiku model
    expect(mockedInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'haiku' })
    )
  })

  it('should return null for non-prompt-related failures', async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      value: {
        response: JSON.stringify({
          category: 'tool_error',
          rootCause: 'Network timeout while downloading dependency',
          suggestion: 'Retry the operation',
          isPromptRelated: false,
        }),
        sessionId: 'test-session',
        durationApiMs: 1000,
        costUsd: 0.001,
      },
    } as any)

    const task = createMockTask()
    const workflow = createMockWorkflow()
    const instance = createMockInstance(true)

    const result = await analyzeFailure(task, workflow, instance, 'pv-test')
    expect(result).toBe(null)
  })

  it('should return null when backend invocation fails', async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: false,
      error: { message: 'Backend unavailable', code: 'BACKEND_ERROR' },
    } as any)

    const task = createMockTask()
    const workflow = createMockWorkflow()
    const instance = createMockInstance(true)

    const result = await analyzeFailure(task, workflow, instance, 'pv-test')
    expect(result).toBe(null)
  })

  it('should return null when LLM response is unparseable', async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      value: {
        response: 'This is not valid JSON at all',
        sessionId: 'test-session',
        durationApiMs: 500,
        costUsd: 0.001,
      },
    } as any)

    const task = createMockTask()
    const workflow = createMockWorkflow()
    const instance = createMockInstance(true)

    const result = await analyzeFailure(task, workflow, instance, 'pv-test')
    expect(result).toBe(null)
  })

  it('should handle context_insufficient category', async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      value: {
        response: JSON.stringify({
          category: 'context_insufficient',
          rootCause: 'Missing project structure info',
          suggestion: 'Include file tree in prompt',
          isPromptRelated: true,
        }),
        sessionId: 'test-session',
        durationApiMs: 800,
        costUsd: 0.001,
      },
    } as any)

    const task = createMockTask()
    const workflow = createMockWorkflow()
    const instance = createMockInstance(true)

    const result = await analyzeFailure(task, workflow, instance, 'pv-test')
    expect(result).not.toBe(null)
    expect(result!.rootCause).toContain('context_insufficient')
  })

  it('should handle multiple failed nodes', async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      value: {
        response: JSON.stringify({
          category: 'prompt_unclear',
          rootCause: 'Ambiguous instructions',
          suggestion: 'Clarify steps',
          isPromptRelated: true,
        }),
        sessionId: 'test-session',
        durationApiMs: 1200,
        costUsd: 0.002,
      },
    } as any)

    const task = createMockTask()
    const workflow: Workflow = {
      ...createMockWorkflow(),
      nodes: [
        { id: 'start', type: 'start', name: 'Start' },
        {
          id: 'node-1',
          type: 'task',
          name: 'Step 1',
          task: { persona: 'Pragmatist', prompt: 'Step 1' },
        },
        {
          id: 'node-2',
          type: 'task',
          name: 'Step 2',
          task: { persona: 'Pragmatist', prompt: 'Step 2' },
        },
        { id: 'end', type: 'end', name: 'End' },
      ],
    }
    const instance: WorkflowInstance = {
      ...createMockInstance(true),
      nodeStates: {
        'node-1': { status: 'failed', error: 'Error 1', attempts: 2 },
        'node-2': { status: 'failed', error: 'Error 2', attempts: 1 },
      },
    }

    const result = await analyzeFailure(task, workflow, instance, 'pv-test')
    expect(result).not.toBe(null)
    expect(result!.failedNodes).toHaveLength(2)
  })
})

// ============================================================
// generateImprovement tests
// ============================================================

describe('generateImprovement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when no failures provided', async () => {
    const persona = trackPersona(`test-gen-empty-${Date.now()}`)
    const version = createMockVersion(persona)

    const result = await generateImprovement(version, [])
    expect(result).toBe(null)
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('should generate improved version from failure analysis', async () => {
    const persona = trackPersona(`test-gen-${Date.now()}`)
    const version = createMockVersion(persona)
    savePromptVersion(version)

    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      value: {
        response: JSON.stringify({
          improvedPrompt: 'You are a pragmatic developer. Always check imports before writing code.',
          changelog: 'Added explicit import checking instruction to prevent build errors',
        }),
        sessionId: 'test-session',
        durationApiMs: 3000,
        costUsd: 0.01,
      },
    } as any)

    const failures: FailureAnalysis[] = [
      {
        taskId: 'task-1',
        personaName: persona,
        versionId: version.id,
        failedNodes: [
          { nodeId: 'node-1', nodeName: 'Build', error: 'Missing import', attempts: 3 },
        ],
        rootCause: '[prompt_unclear] Missing import guidance',
        suggestion: 'Add import checking instructions',
        analyzedAt: new Date().toISOString(),
      },
    ]

    const result = await generateImprovement(version, failures)

    expect(result).not.toBe(null)
    expect(result!.status).toBe('candidate')
    expect(result!.personaName).toBe(persona)
    expect(result!.parentVersionId).toBe(version.id)
    expect(result!.version).toBe(2) // version incremented from 1
    expect(result!.systemPrompt).toContain('Always check imports')
    expect(result!.changelog).toContain('import')
    expect(result!.stats.totalTasks).toBe(0) // fresh stats

    // Should have called backend with sonnet model
    expect(mockedInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'sonnet' })
    )

    // Should have been saved to store
    const saved = getPromptVersion(persona, result!.id)
    expect(saved).not.toBe(null)
    expect(saved!.systemPrompt).toBe(result!.systemPrompt)
  })

  it('should return null when backend fails', async () => {
    const persona = trackPersona(`test-gen-fail-${Date.now()}`)
    const version = createMockVersion(persona)
    savePromptVersion(version)

    mockedInvoke.mockResolvedValueOnce({
      ok: false,
      error: { message: 'Service unavailable', code: 'BACKEND_ERROR' },
    } as any)

    const failures: FailureAnalysis[] = [
      {
        taskId: 'task-1',
        personaName: persona,
        versionId: version.id,
        failedNodes: [],
        rootCause: 'test',
        suggestion: 'test',
        analyzedAt: new Date().toISOString(),
      },
    ]

    const result = await generateImprovement(version, failures)
    expect(result).toBe(null)
  })

  it('should return null when response is unparseable', async () => {
    const persona = trackPersona(`test-gen-parse-${Date.now()}`)
    const version = createMockVersion(persona)
    savePromptVersion(version)

    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      value: {
        response: 'invalid response without JSON',
        sessionId: 'test-session',
        durationApiMs: 2000,
        costUsd: 0.005,
      },
    } as any)

    const failures: FailureAnalysis[] = [
      {
        taskId: 'task-1',
        personaName: persona,
        versionId: version.id,
        failedNodes: [],
        rootCause: 'test',
        suggestion: 'test',
        analyzedAt: new Date().toISOString(),
      },
    ]

    const result = await generateImprovement(version, failures)
    expect(result).toBe(null)
  })
})

// ============================================================
// manageVersions tests
// ============================================================

describe('manageVersions', () => {
  describe('saveNewVersion', () => {
    it('should create and save a new active version', () => {
      const persona = trackPersona(`test-save-${Date.now()}`)

      const result = saveNewVersion(persona, 'You are a test persona.', 'Initial version')

      expect(result.personaName).toBe(persona)
      expect(result.status).toBe('active')
      expect(result.version).toBe(1)
      expect(result.systemPrompt).toBe('You are a test persona.')
      expect(result.stats.totalTasks).toBe(0)

      // Should be persisted
      const saved = getPromptVersion(persona, result.id)
      expect(saved).not.toBe(null)
    })

    it('should accept custom version number and parentVersionId', () => {
      const persona = trackPersona(`test-save-custom-${Date.now()}`)

      const result = saveNewVersion(persona, 'Prompt v3', 'Changelog', 'pv-parent', 3)

      expect(result.version).toBe(3)
      expect(result.parentVersionId).toBe('pv-parent')
    })
  })

  describe('getActivePrompt', () => {
    it('should return systemPrompt of active version', () => {
      const persona = trackPersona(`test-getprompt-${Date.now()}`)
      saveNewVersion(persona, 'Active prompt content', 'test')

      const prompt = getActivePrompt(persona)
      expect(prompt).toBe('Active prompt content')
    })

    it('should return null when no version exists', () => {
      const prompt = getActivePrompt('nonexistent-persona-xyz')
      expect(prompt).toBe(null)
    })
  })

  describe('rollbackVersion', () => {
    it('should rollback to target version', () => {
      const persona = trackPersona(`test-rb-${Date.now()}`)

      const v1 = createMockVersion(persona, { version: 1, status: 'retired' })
      const v2 = createMockVersion(persona, { version: 2, status: 'active' })
      savePromptVersion(v1)
      savePromptVersion(v2)

      const result = rollbackVersion(persona, v1.id)
      expect(result).not.toBe(null)
      expect(result!.status).toBe('active')
      expect(result!.version).toBe(1)
    })

    it('should return null for non-existent target', () => {
      const persona = trackPersona(`test-rb-null-${Date.now()}`)
      const result = rollbackVersion(persona, 'pv-nonexistent')
      expect(result).toBe(null)
    })
  })

  describe('recordUsage', () => {
    it('should increment success count on success', () => {
      const persona = trackPersona(`test-usage-s-${Date.now()}`)
      const version = createMockVersion(persona)
      savePromptVersion(version)

      recordUsage(persona, version.id, true, 5000)

      const updated = getPromptVersion(persona, version.id)
      expect(updated!.stats.totalTasks).toBe(1)
      expect(updated!.stats.successCount).toBe(1)
      expect(updated!.stats.failureCount).toBe(0)
      expect(updated!.stats.successRate).toBe(1)
      expect(updated!.stats.avgDurationMs).toBe(5000)
      expect(updated!.stats.lastUsedAt).toBeDefined()
    })

    it('should increment failure count on failure', () => {
      const persona = trackPersona(`test-usage-f-${Date.now()}`)
      const version = createMockVersion(persona)
      savePromptVersion(version)

      recordUsage(persona, version.id, false, 3000)

      const updated = getPromptVersion(persona, version.id)
      expect(updated!.stats.totalTasks).toBe(1)
      expect(updated!.stats.successCount).toBe(0)
      expect(updated!.stats.failureCount).toBe(1)
      expect(updated!.stats.successRate).toBe(0)
    })

    it('should calculate rolling average duration', () => {
      const persona = trackPersona(`test-usage-avg-${Date.now()}`)
      const version = createMockVersion(persona)
      savePromptVersion(version)

      recordUsage(persona, version.id, true, 4000) // avg = 4000
      recordUsage(persona, version.id, true, 6000) // avg = (4000 + 6000) / 2 = 5000

      const updated = getPromptVersion(persona, version.id)
      expect(updated!.stats.totalTasks).toBe(2)
      expect(updated!.stats.avgDurationMs).toBe(5000)
      expect(updated!.stats.successRate).toBe(1)
    })

    it('should handle mixed success/failure correctly', () => {
      const persona = trackPersona(`test-usage-mix-${Date.now()}`)
      const version = createMockVersion(persona)
      savePromptVersion(version)

      recordUsage(persona, version.id, true, 2000)
      recordUsage(persona, version.id, false, 3000)
      recordUsage(persona, version.id, true, 4000)

      const updated = getPromptVersion(persona, version.id)
      expect(updated!.stats.totalTasks).toBe(3)
      expect(updated!.stats.successCount).toBe(2)
      expect(updated!.stats.failureCount).toBe(1)
      expect(updated!.stats.successRate).toBeCloseTo(2 / 3, 5)
    })

    it('should not throw for non-existent version', () => {
      const persona = trackPersona(`test-usage-ne-${Date.now()}`)
      expect(() => recordUsage(persona, 'pv-nonexistent', true, 1000)).not.toThrow()
    })
  })
})

// ============================================================
// Integration test: full prompt optimization flow
// ============================================================

describe('Prompt Optimization Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should complete the full flow: fail → analyze → improve → use new version', async () => {
    const persona = trackPersona(`test-integ-${Date.now()}`)

    // Step 1: Create initial active version
    const v1 = saveNewVersion(persona, 'You are a developer. Write code.', 'Initial')

    // Step 2: Record some failures
    recordUsage(persona, v1.id, false, 5000)
    recordUsage(persona, v1.id, false, 6000)
    recordUsage(persona, v1.id, false, 7000)

    const v1Updated = getPromptVersion(persona, v1.id)!
    expect(v1Updated.stats.failureCount).toBe(3)
    expect(v1Updated.stats.successRate).toBe(0)

    // Step 3: Analyze failure (mock LLM says it's prompt-related)
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      value: {
        response: JSON.stringify({
          category: 'prompt_unclear',
          rootCause: 'Prompt lacks specificity about error handling',
          suggestion: 'Add error handling instructions',
          isPromptRelated: true,
        }),
        sessionId: 's1',
        durationApiMs: 1000,
        costUsd: 0.001,
      },
    } as any)

    const task = createMockTask()
    const workflow = createMockWorkflow(persona)
    const instance = createMockInstance(true)

    const analysis = await analyzeFailure(task, workflow, instance, v1.id)
    expect(analysis).not.toBe(null)
    expect(analysis!.rootCause).toContain('prompt_unclear')

    // Step 4: Generate improvement
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      value: {
        response: JSON.stringify({
          improvedPrompt:
            'You are a developer. Write code with proper error handling. Always validate inputs.',
          changelog: 'Added error handling and input validation instructions',
        }),
        sessionId: 's2',
        durationApiMs: 3000,
        costUsd: 0.01,
      },
    } as any)

    const improved = await generateImprovement(v1Updated, [analysis!])
    expect(improved).not.toBe(null)
    expect(improved!.status).toBe('candidate')
    expect(improved!.version).toBe(2)
    expect(improved!.parentVersionId).toBe(v1.id)

    // Step 5: Verify the active version is still v1 (candidate hasn't been promoted)
    const activePrompt = getActivePrompt(persona)
    expect(activePrompt).toBe('You are a developer. Write code.')

    // Step 6: Verify both versions exist
    const allVersions = getAllVersions(persona)
    expect(allVersions).toHaveLength(2)

    // Step 7: Rollback would work (here we just verify the candidate exists)
    const candidate = getPromptVersion(persona, improved!.id)
    expect(candidate).not.toBe(null)
    expect(candidate!.systemPrompt).toContain('error handling')
  })
})
