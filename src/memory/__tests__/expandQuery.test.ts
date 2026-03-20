/**
 * expandQuery tests — LLM query expansion with cache, timeout, and fallback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvokeBackend = vi.fn()
vi.mock('../../backend/index.js', () => ({
  invokeBackend: (...args: unknown[]) => mockInvokeBackend(...args),
}))

import { expandQueryForRetrieval, clearExpandCache } from '../expandQuery.js'

describe('expandQueryForRetrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearExpandCache()
  })

  it('normal expansion: returns deduplicated terms from LLM JSON response', async () => {
    mockInvokeBackend.mockResolvedValue({
      ok: true,
      value: {
        response: '["workflow","节点","node","执行","失败","task","failed","workflow"]',
      },
    })

    const result = await expandQueryForRetrieval('workflow 节点执行失败')

    expect(result).toEqual(['workflow', '节点', 'node', '执行', '失败', 'task', 'failed'])
    expect(mockInvokeBackend).toHaveBeenCalledOnce()
    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'haiku',
        disableMcp: true,
      })
    )
  })

  it('JSON parse failure: returns [] when LLM returns non-JSON text', async () => {
    mockInvokeBackend.mockResolvedValue({
      ok: true,
      value: { response: 'Sorry, I cannot process that request.' },
    })

    const result = await expandQueryForRetrieval('test query')

    expect(result).toEqual([])
  })

  it('LLM call failure: returns [] when invokeBackend returns ok=false', async () => {
    mockInvokeBackend.mockResolvedValue({
      ok: false,
      error: { message: 'rate limited' },
    })

    const result = await expandQueryForRetrieval('test query')

    expect(result).toEqual([])
  })

  it('timeout: returns [] when LLM takes longer than 4s', async () => {
    vi.useFakeTimers()

    mockInvokeBackend.mockImplementation(
      () =>
        new Promise(resolve => {
          setTimeout(() => resolve({ ok: true, value: { response: '["a"]' } }), 15000)
        })
    )

    const promise = expandQueryForRetrieval('slow query')

    // Advance past the 4s race timeout
    await vi.advanceTimersByTimeAsync(5000)

    const result = await promise

    expect(result).toEqual([])

    vi.useRealTimers()
  })

  it('cache hit: second call with same query does not invoke backend', async () => {
    mockInvokeBackend.mockResolvedValue({
      ok: true,
      value: { response: '["term1","term2"]' },
    })

    const first = await expandQueryForRetrieval('cached query')
    const second = await expandQueryForRetrieval('cached query')

    expect(first).toEqual(['term1', 'term2'])
    expect(second).toEqual(['term1', 'term2'])
    expect(mockInvokeBackend).toHaveBeenCalledOnce()
  })

  it('empty string filter: removes empty strings from result', async () => {
    mockInvokeBackend.mockResolvedValue({
      ok: true,
      value: { response: '["valid", "", "  ", "also valid"]' },
    })

    const result = await expandQueryForRetrieval('filter test')

    expect(result).toEqual(['valid', 'also valid'])
  })

  it('empty query: returns [] without calling backend', async () => {
    const result = await expandQueryForRetrieval('  ')

    expect(result).toEqual([])
    expect(mockInvokeBackend).not.toHaveBeenCalled()
  })

  it('backend exception: returns [] when invokeBackend throws', async () => {
    mockInvokeBackend.mockRejectedValue(new Error('network error'))

    const result = await expandQueryForRetrieval('error query')

    expect(result).toEqual([])
  })
})
