import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../backend/index.js', () => ({
  invokeBackend: vi.fn(),
}))

import { reviewImprovement, reviewImprovements } from '../reviewImprovement.js'
import { invokeBackend } from '../../backend/index.js'
import type { Improvement, FailurePattern } from '../types.js'

type InvokeReturn = Awaited<ReturnType<typeof invokeBackend>>

function makeImprovement(id: string): Improvement {
  return {
    id,
    source: 'prompt',
    description: 'Fix JSON parsing in planning',
    personaName: 'Pragmatist',
    detail: 'Improve prompt clarity for JSON output',
    triggeredBy: 'task-1',
  }
}

function mockOkResponse(response: string): InvokeReturn {
  return {
    ok: true,
    value: { response },
  } as unknown as InvokeReturn
}

const defaultContext = {
  patterns: [
    {
      category: 'prompt' as const,
      description: 'planning failures',
      occurrences: 3,
      taskIds: ['t1', 't2', 't3'],
      sampleErrors: ['JSON parse error'],
    },
  ] satisfies FailurePattern[],
}

describe('reviewImprovement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns approved result when backend approves', async () => {
    vi.mocked(invokeBackend).mockResolvedValue(mockOkResponse(JSON.stringify({
      approved: true,
      confidence: 0.9,
      reasoning: 'The improvement addresses the root cause',
      suggestions: [],
      risksIdentified: [],
    })))

    const result = await reviewImprovement(makeImprovement('imp-1'), defaultContext)
    expect(result.approved).toBe(true)
    expect(result.confidence).toBe(0.9)
    expect(result.reasoning).toBe('The improvement addresses the root cause')
  })

  it('returns rejected result when backend rejects', async () => {
    vi.mocked(invokeBackend).mockResolvedValue(mockOkResponse(JSON.stringify({
      approved: false,
      confidence: 0.8,
      reasoning: 'Too broad scope',
      suggestions: ['Narrow the scope'],
      risksIdentified: ['May break other prompts'],
    })))

    const result = await reviewImprovement(makeImprovement('imp-1'), defaultContext)
    expect(result.approved).toBe(false)
    expect(result.confidence).toBe(0.8)
    expect(result.reasoning).toBe('Too broad scope')
    expect(result.suggestions).toEqual(['Narrow the scope'])
    expect(result.risksIdentified).toEqual(['May break other prompts'])
  })

  it('falls back to auto-approve on backend error', async () => {
    vi.mocked(invokeBackend).mockResolvedValue({
      ok: false,
      error: { message: 'Backend unavailable' },
    } as unknown as InvokeReturn)

    const result = await reviewImprovement(makeImprovement('imp-1'), defaultContext)
    expect(result.approved).toBe(true)
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toContain('review backend error')
  })

  it('falls back to auto-approve on exception', async () => {
    vi.mocked(invokeBackend).mockRejectedValue(new Error('Network error'))

    const result = await reviewImprovement(makeImprovement('imp-1'), defaultContext)
    expect(result.approved).toBe(true)
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toContain('review unavailable')
  })

  it('handles malformed JSON response', async () => {
    vi.mocked(invokeBackend).mockResolvedValue(mockOkResponse('This is not JSON at all'))

    const result = await reviewImprovement(makeImprovement('imp-1'), defaultContext)
    expect(result.approved).toBe(true)
    expect(result.confidence).toBe(0)
    expect(result.reasoning).toContain('failed to parse')
  })

  it('extracts JSON embedded in markdown response', async () => {
    vi.mocked(invokeBackend).mockResolvedValue(mockOkResponse(
      'Here is my review:\n```json\n{"approved": false, "confidence": 0.7, "reasoning": "Not targeted enough"}\n```'
    ))

    const result = await reviewImprovement(makeImprovement('imp-1'), defaultContext)
    expect(result.approved).toBe(false)
    expect(result.confidence).toBe(0.7)
  })

  it('clamps confidence to 0-1 range', async () => {
    vi.mocked(invokeBackend).mockResolvedValue(mockOkResponse(JSON.stringify({
      approved: true,
      confidence: 5.0,
      reasoning: 'Very confident',
    })))

    const result = await reviewImprovement(makeImprovement('imp-1'), defaultContext)
    expect(result.confidence).toBe(1)
  })
})

describe('reviewImprovements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reviews multiple improvements sequentially', async () => {
    let callCount = 0
    vi.mocked(invokeBackend).mockImplementation(async () => {
      callCount++
      return mockOkResponse(JSON.stringify({
        approved: callCount === 1, // first approved, second rejected
        confidence: 0.8,
        reasoning: callCount === 1 ? 'Good' : 'Bad',
      }))
    })

    const results = await reviewImprovements(
      [makeImprovement('imp-1'), makeImprovement('imp-2')],
      defaultContext
    )

    expect(results).toHaveLength(2)
    expect(results[0]!.improvementId).toBe('imp-1')
    expect(results[0]!.review.approved).toBe(true)
    expect(results[1]!.improvementId).toBe('imp-2')
    expect(results[1]!.review.approved).toBe(false)
  })

  it('returns empty array for empty improvements', async () => {
    const results = await reviewImprovements([], defaultContext)
    expect(results).toHaveLength(0)
    expect(invokeBackend).not.toHaveBeenCalled()
  })
})
