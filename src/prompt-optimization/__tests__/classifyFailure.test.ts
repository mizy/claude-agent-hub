import { describe, it, expect } from 'vitest'
import { classifyFailure } from '../classifyFailure.js'
import type { FailedNodeInfo } from '../../types/promptVersion.js'

function makeNode(error: string, nodeId = 'node-1'): FailedNodeInfo {
  return { nodeId, nodeName: 'test-node', error, attempts: 1 }
}

describe('classifyFailure', () => {
  it('classifies planning failures', () => {
    const r1 = classifyFailure([makeNode('Failed to parse workflow JSON')])
    expect(r1.category).toBe('planning')
    expect(r1.confidence).toBeGreaterThanOrEqual(0.6)
    expect(r1.matchedPatterns).toContain('json')
    expect(r1.matchedPatterns).toContain('parse')
    expect(r1.matchedPatterns).toContain('workflow')

    const r2 = classifyFailure([makeNode('Invalid JSON response from LLM')])
    expect(r2.category).toBe('planning')
    expect(r2.matchedPatterns).toContain('json')
    expect(r2.matchedPatterns).toContain('invalid_response')
  })

  it('classifies execution failures', () => {
    const r1 = classifyFailure([makeNode('Command timed out after 120s')])
    expect(r1.category).toBe('execution')
    expect(r1.matchedPatterns).toContain('timeout')

    const r2 = classifyFailure([makeNode('command not found: xyz')])
    expect(r2.category).toBe('execution')
    expect(r2.matchedPatterns).toContain('command_not_found')
  })

  it('classifies validation failures', () => {
    const r1 = classifyFailure([makeNode('error TS2345: Argument of type')])
    expect(r1.category).toBe('validation')
    expect(r1.matchedPatterns).toContain('ts_error')

    const r2 = classifyFailure([makeNode('FAIL src/test.test.ts')])
    expect(r2.category).toBe('validation')
    expect(r2.matchedPatterns).toContain('test_fail')
  })

  it('classifies resource failures', () => {
    const r1 = classifyFailure([makeNode('JavaScript heap out of memory')])
    expect(r1.category).toBe('resource')
    expect(r1.matchedPatterns).toContain('heap')
    expect(r1.matchedPatterns).toContain('out_of_memory')

    const r2 = classifyFailure([makeNode('ENOSPC: no space left on device')])
    expect(r2.category).toBe('resource')
    expect(r2.matchedPatterns).toContain('ENOSPC')
    expect(r2.matchedPatterns).toContain('no_space')
  })

  it('returns unknown for unmatched patterns', () => {
    const r = classifyFailure([makeNode('Something completely unexpected happened')])
    expect(r.category).toBe('unknown')
    expect(r.confidence).toBe(0)
    expect(r.matchedPatterns).toEqual([])
  })

  it('returns unknown for empty failedNodes', () => {
    const r = classifyFailure([])
    expect(r.category).toBe('unknown')
    expect(r.confidence).toBe(0)
    expect(r.matchedPatterns).toEqual([])
    expect(r.raw).toBe('')
  })

  it('increases confidence with more matched patterns', () => {
    const r1 = classifyFailure([makeNode('timed out')])
    expect(r1.confidence).toBe(0.6)

    const r2 = classifyFailure([makeNode('ETIMEDOUT: timed out')])
    expect(r2.confidence).toBe(0.8)

    const r3 = classifyFailure([makeNode('Failed to parse workflow JSON response')])
    expect(r3.confidence).toBe(0.95)
  })

  it('aggregates errors from multiple nodes', () => {
    const r = classifyFailure([
      makeNode('error TS2345: type mismatch', 'node-1'),
      makeNode('FAIL src/foo.test.ts', 'node-2'),
    ])
    expect(r.category).toBe('validation')
    expect(r.matchedPatterns.length).toBeGreaterThanOrEqual(2)
  })
})
