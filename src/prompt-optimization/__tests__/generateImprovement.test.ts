/**
 * generateImprovement 测试
 *
 * 测试改进建议生成和版本管理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { generateImprovement } from '../generateImprovement.js'
import { DATA_DIR } from '../../store/paths.js'
import type { PromptVersion, FailureAnalysis } from '../../types/promptVersion.js'

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

function makeVersion(overrides?: Partial<PromptVersion>): PromptVersion {
  return {
    id: 'pv-test-001',
    personaName: 'Pragmatist',
    version: 1,
    systemPrompt: 'You are a pragmatic developer.',
    changelog: 'Initial version',
    stats: {
      totalTasks: 10,
      successCount: 6,
      failureCount: 4,
      successRate: 0.6,
      avgDurationMs: 5000,
    },
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeFailure(overrides?: Partial<FailureAnalysis>): FailureAnalysis {
  return {
    taskId: 'task-fail-001',
    personaName: 'Pragmatist',
    versionId: 'pv-test-001',
    failedNodes: [
      {
        nodeId: 'node-1',
        nodeName: 'Build',
        error: 'Build failed',
        attempts: 2,
      },
    ],
    rootCause: '[prompt_unclear] Ambiguous build instructions',
    suggestion: 'Specify exact build command',
    analyzedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('generateImprovement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clean and recreate prompt-versions dir to avoid cross-test contamination
    const pvDir = join(DATA_DIR, 'prompt-versions')
    rmSync(pvDir, { recursive: true, force: true })
    mkdirSync(join(pvDir, 'Pragmatist'), { recursive: true })
  })

  it('should return null when no failures provided', async () => {
    const result = await generateImprovement(makeVersion(), [])
    expect(result).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('should generate a new candidate version on success', async () => {
    mockInvoke.mockResolvedValue(mockOkResponse(JSON.stringify({
      improvedPrompt: 'You are a pragmatic developer. Always specify exact build commands.',
      changelog: 'Added explicit build command guidance to reduce ambiguity',
    })))

    const result = await generateImprovement(makeVersion(), [makeFailure()])

    expect(result).not.toBeNull()
    expect(result!.id).toMatch(/^pv-/)
    expect(result!.personaName).toBe('Pragmatist')
    expect(result!.parentVersionId).toBe('pv-test-001')
    expect(result!.systemPrompt).toContain('exact build commands')
    expect(result!.changelog).toContain('build command')
    expect(result!.status).toBe('candidate')
    expect(result!.stats.totalTasks).toBe(0)
    expect(result!.stats.successRate).toBe(0)
  })

  it('should return null when backend call fails', async () => {
    mockInvoke.mockResolvedValue({
      ok: false,
      error: { message: 'Service unavailable' },
    } as unknown as InvokeReturn)

    const result = await generateImprovement(makeVersion(), [makeFailure()])
    expect(result).toBeNull()
  })

  it('should return null when response JSON is invalid', async () => {
    mockInvoke.mockResolvedValue(mockOkResponse('Not valid JSON at all'))

    const result = await generateImprovement(makeVersion(), [makeFailure()])
    expect(result).toBeNull()
  })

  it('should return null when response missing required fields', async () => {
    mockInvoke.mockResolvedValue(mockOkResponse(JSON.stringify({
      improvedPrompt: 'Updated prompt',
      // missing changelog
    })))

    const result = await generateImprovement(makeVersion(), [makeFailure()])
    expect(result).toBeNull()
  })

  it('should increment version number correctly', async () => {
    // Use a unique persona to avoid interference from other tests
    const persona = 'VersionTestBot'
    mkdirSync(join(DATA_DIR, 'prompt-versions', persona), { recursive: true })

    const { savePromptVersion } = await import('../../store/PromptVersionStore.js')
    savePromptVersion(makeVersion({ version: 3, id: 'pv-existing-003', personaName: persona }))

    mockInvoke.mockResolvedValue(mockOkResponse(JSON.stringify({
      improvedPrompt: 'Better prompt',
      changelog: 'Improved clarity',
    })))

    const result = await generateImprovement(
      makeVersion({ personaName: persona }),
      [makeFailure()]
    )

    expect(result).not.toBeNull()
    expect(result!.version).toBe(4)
  })

  it('should call backend with sonnet model', async () => {
    mockInvoke.mockResolvedValue(mockOkResponse(JSON.stringify({
      improvedPrompt: 'Better prompt',
      changelog: 'Fixed issues',
    })))

    await generateImprovement(makeVersion(), [makeFailure()])

    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'sonnet' })
    )
  })
})
