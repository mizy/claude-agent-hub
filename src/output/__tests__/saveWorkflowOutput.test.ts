/**
 * saveWorkflowOutput tests
 * Tests pure formatting functions for workflow output
 */

import { describe, it, expect } from 'vitest'
import {
  calculateTotalDuration,
  formatNodeState,
  formatWorkflowOutput,
  type WorkflowExecutionResult,
} from '../saveWorkflowOutput.js'

describe('calculateTotalDuration', () => {
  it('should calculate duration between two timestamps', () => {
    const result = calculateTotalDuration(
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T00:05:30.000Z'
    )
    expect(result).toContain('5')
    expect(result).toContain('30')
  })

  it('should handle zero duration', () => {
    const ts = '2024-01-01T00:00:00.000Z'
    const result = calculateTotalDuration(ts, ts)
    expect(result).toBeDefined()
  })
})

describe('formatNodeState', () => {
  it('should format completed node', () => {
    const result = formatNodeState('node-1', 'Build', {
      status: 'done',
      attempts: 1,
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: '2024-01-01T00:01:00Z',
    })

    expect(result).toContain('Build')
    expect(result).toContain('done')
    expect(result).toContain('Attempts')
  })

  it('should format failed node with error', () => {
    const result = formatNodeState('node-2', 'Deploy', {
      status: 'failed',
      attempts: 3,
      error: 'Connection timeout',
    })

    expect(result).toContain('Deploy')
    expect(result).toContain('failed')
    expect(result).toContain('Connection timeout')
  })

  it('should format string output directly', () => {
    const result = formatNodeState(
      'node-3',
      'Test',
      { status: 'done', attempts: 1 },
      'All 42 tests passed'
    )

    expect(result).toContain('All 42 tests passed')
    expect(result).toContain('**Output:**')
  })

  it('should extract _raw markdown and output without code block', () => {
    const result = formatNodeState(
      'node-4',
      'Analyze',
      { status: 'done', attempts: 1 },
      { _raw: '## Analysis Report\n- Found 3 issues\n- Fixed 2 bugs' }
    )

    // Should contain the raw markdown content
    expect(result).toContain('## Analysis Report')
    expect(result).toContain('- Found 3 issues')
    // Should NOT be wrapped in a code block (markdown detected)
    const outputSection = result.split('**Output:**')[1]
    expect(outputSection).not.toMatch(/^```\n##/m)
  })

  it('should wrap _raw non-markdown content in code block', () => {
    const result = formatNodeState(
      'node-4b',
      'Data',
      { status: 'done', attempts: 1 },
      { _raw: '{"key": "value", "count": 42}' }
    )

    // Should contain the raw content
    expect(result).toContain('{"key": "value", "count": 42}')
    // Should be wrapped in code block (no markdown markers detected)
    const outputSection = result.split('**Output:**')[1]
    expect(outputSection).toContain('```')
  })

  it('should JSON.stringify plain objects without _raw', () => {
    const result = formatNodeState(
      'node-4c',
      'Check',
      { status: 'done', attempts: 1 },
      { result: true, count: 5 }
    )

    // Should contain JSON representation
    expect(result).toContain('"result": true')
    expect(result).toContain('"count": 5')
    // Should be wrapped in code block
    const outputSection = result.split('**Output:**')[1]
    expect(outputSection).toContain('```')
  })

  it('should not output anything when output is undefined', () => {
    const result = formatNodeState(
      'node-4d',
      'NoOutput',
      { status: 'done', attempts: 1 },
      undefined
    )

    expect(result).not.toContain('**Output:**')
  })

  it('should truncate output exceeding MAX_NODE_OUTPUT_LENGTH', () => {
    const longOutput = 'x'.repeat(15000)
    const result = formatNodeState(
      'node-5',
      'Long',
      { status: 'done', attempts: 1 },
      longOutput
    )

    expect(result).toContain('... (truncated)')
    // Should be significantly shorter than the original
    expect(result.length).toBeLessThan(longOutput.length)
    // Should contain at most ~10000 chars of the output (MAX_NODE_OUTPUT_LENGTH)
    expect(result.length).toBeLessThan(11000)
  })

  it('should not truncate output within limit', () => {
    const output = 'y'.repeat(5000)
    const result = formatNodeState(
      'node-5b',
      'Short',
      { status: 'done', attempts: 1 },
      output
    )

    expect(result).not.toContain('truncated')
    expect(result).toContain(output)
  })

  it('should use status emoji', () => {
    const pending = formatNodeState('n', 'Pending', { status: 'pending', attempts: 0 })
    const running = formatNodeState('n', 'Running', { status: 'running', attempts: 1 })
    const done = formatNodeState('n', 'Done', { status: 'done', attempts: 1 })
    const failed = formatNodeState('n', 'Failed', { status: 'failed', attempts: 1 })

    expect(pending).toContain('⏳')
    expect(running).toContain('🔵')
    expect(done).toContain('✅')
    expect(failed).toContain('❌')
  })
})

describe('formatWorkflowOutput', () => {
  const makeResult = (overrides?: Partial<WorkflowExecutionResult>): WorkflowExecutionResult => ({
    task: {
      id: 'task-abc123',
      title: 'Test Task',
      description: 'A test task',
      priority: 'medium',
      status: 'completed',
      retryCount: 0,
      createdAt: '2024-01-01T00:00:00Z',
    },
    workflow: {
      id: 'wf-xyz',
      taskId: 'task-abc123',
      name: 'Test Workflow',
      description: 'Workflow description',
      version: '2.0',
      nodes: [
        { id: 'start', type: 'start', name: 'Start' },
        { id: 'build', type: 'task', name: 'Build', task: { persona: 'Pragmatist', prompt: 'build it' } },
        { id: 'end', type: 'end', name: 'End' },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'build' },
        { id: 'e2', from: 'build', to: 'end' },
      ],
      variables: {},
      createdAt: '2024-01-01T00:00:00Z',
    },
    instance: {
      id: 'inst-001',
      workflowId: 'wf-xyz',
      status: 'completed',
      nodeStates: {
        build: { status: 'done', attempts: 1, startedAt: '2024-01-01T00:00:10Z', completedAt: '2024-01-01T00:01:00Z' },
      },
      outputs: {
        build: 'Build successful',
      },
      variables: {},
      loopCounts: {},
    },
    timing: {
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: '2024-01-01T00:01:00Z',
    },
    ...overrides,
  })

  it('should produce valid markdown', () => {
    const result = formatWorkflowOutput(makeResult())
    expect(result).toContain('# Test Task')
    expect(result).toContain('task-abc123')
    expect(result).toContain('medium')
    expect(result).toContain('Build successful')
  })

  it('should include workflow error when present', () => {
    const result = formatWorkflowOutput(
      makeResult({
        instance: {
          id: 'inst-002',
          workflowId: 'wf-xyz',
          status: 'failed',
          nodeStates: {
            build: { status: 'failed', attempts: 2, error: 'OOM' },
          },
          outputs: {},
          variables: {},
          loopCounts: {},
          error: 'Workflow failed: node build errored',
        },
      })
    )

    expect(result).toContain('Workflow Error')
    expect(result).toContain('Workflow failed')
  })

  it('should skip start and end nodes', () => {
    const result = formatWorkflowOutput(makeResult())
    // Should not show "Start" or "End" as node sections
    expect(result).not.toMatch(/### .* Start/)
    expect(result).not.toMatch(/### .* End/)
  })

  it('should show progress count', () => {
    const result = formatWorkflowOutput(makeResult())
    expect(result).toContain('1/1 completed')
  })
})
