/**
 * nodeResultProcessor tests
 * Tests extractRawOutput, extractStructuredOutput, resolvePersona, buildNodeContext
 */

import { describe, it, expect } from 'vitest'
import {
  extractRawOutput,
  extractStructuredOutput,
  resolvePersona,
  buildNodeContext,
  buildEvalContext,
} from '../nodeResultProcessor.js'
import type { WorkflowInstance } from '../types.js'

describe('extractRawOutput', () => {
  it('should return fallback for null/undefined', () => {
    expect(extractRawOutput(null)).toBe('')
    expect(extractRawOutput(undefined)).toBe('')
    expect(extractRawOutput(null, 'completed')).toBe('completed')
  })

  it('should return string directly', () => {
    expect(extractRawOutput('hello')).toBe('hello')
  })

  it('should extract _raw from object', () => {
    expect(extractRawOutput({ _raw: 'raw text', key: 'value' })).toBe('raw text')
  })

  it('should JSON.stringify object without _raw', () => {
    const obj = { key: 'value', count: 42 }
    expect(extractRawOutput(obj)).toBe(JSON.stringify(obj))
  })

  it('should JSON.stringify if _raw is not a string', () => {
    const obj = { _raw: 123, other: true }
    expect(extractRawOutput(obj)).toBe(JSON.stringify(obj))
  })

  it('should use custom fallback', () => {
    expect(extractRawOutput(undefined, 'N/A')).toBe('N/A')
  })
})

describe('extractStructuredOutput', () => {
  it('should always include _raw field', () => {
    const result = extractStructuredOutput('plain text')
    expect(result._raw).toBe('plain text')
  })

  it('should extract JSON code blocks', () => {
    const response = 'Some text\n```json\n{"key": "value"}\n```\nMore text'
    const result = extractStructuredOutput(response)
    expect(result._raw).toBe(response)
    expect(result.key).toBe('value')
  })

  it('should flatten single result wrapper', () => {
    const response = '```json\n{"result": {"total": 5, "passed": true}}\n```'
    const result = extractStructuredOutput(response)
    expect(result.total).toBe(5)
    expect(result.passed).toBe(true)
  })

  it('should extract key-value patterns from text', () => {
    const response = 'hasTypescript: true\ntestCount: 42'
    const result = extractStructuredOutput(response)
    expect(result.hasTypescript).toBe(true)
    expect(result.testCount).toBe(42)
  })

  it('should not overwrite JSON block values with kv matches', () => {
    const response = '```json\n{"count": 10}\n```\ncount: 99'
    const result = extractStructuredOutput(response)
    expect(result.count).toBe(10)
  })

  it('should handle invalid JSON gracefully', () => {
    const response = '```json\n{invalid json}\n```'
    const result = extractStructuredOutput(response)
    expect(result._raw).toBe(response)
  })
})

describe('resolvePersona', () => {
  it('should return default Pragmatist for undefined', () => {
    const persona = resolvePersona(undefined)
    expect(persona.name).toBe('Pragmatist')
  })

  it('should return default for "auto"', () => {
    const persona = resolvePersona('auto')
    expect(persona.name).toBe('Pragmatist')
  })

  it('should return default for empty string', () => {
    const persona = resolvePersona('')
    expect(persona.name).toBe('Pragmatist')
  })

  it('should find builtin persona by name', () => {
    const persona = resolvePersona('Architect')
    expect(persona.name).toBe('Architect')
  })

  it('should fallback to default for unknown persona', () => {
    const persona = resolvePersona('NonExistent')
    expect(persona.name).toBe('Pragmatist')
  })
})

describe('buildNodeContext', () => {
  const makeInstance = (overrides?: Partial<WorkflowInstance>): WorkflowInstance => ({
    id: 'inst-1',
    workflowId: 'wf-1',
    status: 'running',
    nodeStates: {},
    outputs: {},
    variables: {},
    loopCounts: {},
    ...overrides,
  })

  it('should return empty string when no completed nodes', () => {
    const instance = makeInstance({
      nodeStates: { 'node-1': { status: 'running', attempts: 1 } },
    })
    expect(buildNodeContext(instance)).toBe('')
  })

  it('should include completed nodes with output', () => {
    const instance = makeInstance({
      nodeStates: { analyze: { status: 'done', attempts: 1 } },
      outputs: { analyze: 'Analysis complete' },
    })
    const result = buildNodeContext(instance)
    expect(result).toContain('analyze')
    expect(result).toContain('Analysis complete')
  })

  it('should truncate long output', () => {
    const instance = makeInstance({
      nodeStates: { big: { status: 'done', attempts: 1 } },
      outputs: { big: 'x'.repeat(5000) },
    })
    const result = buildNodeContext(instance)
    expect(result).toContain('... (truncated)')
    expect(result.length).toBeLessThan(5000)
  })

  it('should extract _raw from structured output', () => {
    const instance = makeInstance({
      nodeStates: { step: { status: 'done', attempts: 1 } },
      outputs: { step: { _raw: 'raw text here', data: 123 } },
    })
    const result = buildNodeContext(instance)
    expect(result).toContain('raw text here')
  })
})

describe('buildEvalContext', () => {
  it('should create hyphen aliases for node IDs', () => {
    const instance: WorkflowInstance = {
      id: 'inst-1',
      workflowId: 'wf-1',
      status: 'running',
      nodeStates: {
        'rerun-tests': { status: 'done', attempts: 1 },
      },
      outputs: {
        'rerun-tests': { _raw: 'ok', passed: true },
      },
      variables: {},
      loopCounts: {},
    }

    const ctx = buildEvalContext(instance)
    expect(ctx.outputs['rerun-tests']).toBeDefined()
    expect(ctx.outputs['rerun_tests']).toBeDefined()
    expect(ctx.nodeStates['rerun_tests']).toBeDefined()
  })
})
