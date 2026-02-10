/**
 * parseJson / validateJsonWorkflow / extractJson 测试
 *
 * 覆盖 JSON 工作流解析、验证和提取逻辑
 */

import { describe, it, expect } from 'vitest'
import { parseJson, validateJsonWorkflow, extractJson, type JsonWorkflowInput } from '../parseJson.js'

function makeMinimalInput(overrides: Partial<JsonWorkflowInput> = {}): JsonWorkflowInput {
  return {
    name: 'test-workflow',
    nodes: [
      { id: 'n1', type: 'task', name: 'Task 1', task: { persona: 'coder', prompt: 'do something' } },
    ],
    edges: [],
    ...overrides,
  }
}

describe('parseJson', () => {
  it('should parse minimal valid input', () => {
    const wf = parseJson(makeMinimalInput())
    expect(wf.name).toBe('test-workflow')
    expect(wf.id).toBeTruthy()
    expect(wf.version).toBe('2.0')
    expect(wf.description).toBe('')
    expect(wf.createdAt).toBeTruthy()
  })

  it('should auto-add start and end nodes', () => {
    const wf = parseJson(makeMinimalInput())
    const nodeIds = wf.nodes.map(n => n.id)
    expect(nodeIds).toContain('start')
    expect(nodeIds).toContain('end')
    // Start should be first, end should be last
    expect(wf.nodes[0]?.id).toBe('start')
    expect(wf.nodes[wf.nodes.length - 1]?.id).toBe('end')
  })

  it('should not duplicate start/end nodes if already present', () => {
    const input = makeMinimalInput({
      nodes: [
        { id: 'start', type: 'start', name: '开始' },
        { id: 'n1', type: 'task', name: 'Task 1', task: { persona: 'coder', prompt: 'do' } },
        { id: 'end', type: 'end', name: '结束' },
      ],
    })
    const wf = parseJson(input)
    const startNodes = wf.nodes.filter(n => n.type === 'start')
    const endNodes = wf.nodes.filter(n => n.type === 'end')
    expect(startNodes).toHaveLength(1)
    expect(endNodes).toHaveLength(1)
  })

  it('should auto-generate edge IDs', () => {
    const input = makeMinimalInput({
      nodes: [
        { id: 'start', type: 'start', name: '开始' },
        { id: 'n1', type: 'task', name: 'Task 1', task: { persona: 'coder', prompt: 'do' } },
        { id: 'end', type: 'end', name: '结束' },
      ],
      edges: [
        { from: 'start', to: 'n1' },
        { from: 'n1', to: 'end' },
      ],
    })
    const wf = parseJson(input)
    expect(wf.edges[0]?.id).toBe('e1')
    expect(wf.edges[1]?.id).toBe('e2')
  })

  it('should preserve explicit edge IDs', () => {
    const input = makeMinimalInput({
      nodes: [
        { id: 'start', type: 'start', name: '开始' },
        { id: 'end', type: 'end', name: '结束' },
      ],
      edges: [{ id: 'my-edge', from: 'start', to: 'end' }],
    })
    const wf = parseJson(input)
    expect(wf.edges[0]?.id).toBe('my-edge')
  })

  it('should throw on missing name', () => {
    expect(() => parseJson(makeMinimalInput({ name: '' }))).toThrow('name is required')
  })

  it('should throw on empty nodes', () => {
    expect(() => parseJson(makeMinimalInput({ nodes: [] }))).toThrow('At least one node')
  })

  it('should throw on edge referencing unknown source node', () => {
    const input = makeMinimalInput({
      edges: [{ from: 'nonexistent', to: 'n1' }],
    })
    expect(() => parseJson(input)).toThrow('unknown source node: nonexistent')
  })

  it('should throw on edge referencing unknown target node', () => {
    const input = makeMinimalInput({
      edges: [{ from: 'n1', to: 'nonexistent' }],
    })
    expect(() => parseJson(input)).toThrow('unknown target node: nonexistent')
  })

  it('should throw on loop referencing unknown body node', () => {
    const input = makeMinimalInput({
      nodes: [
        {
          id: 'loop1',
          type: 'loop',
          name: 'Loop',
          loop: { type: 'while', condition: 'true', bodyNodes: ['missing'] },
        },
      ],
    })
    expect(() => parseJson(input)).toThrow('unknown body node: missing')
  })

  it('should throw on foreach referencing unknown body node', () => {
    const input = makeMinimalInput({
      nodes: [
        {
          id: 'fe1',
          type: 'foreach',
          name: 'ForEach',
          foreach: { collection: '${items}', itemVar: 'item', bodyNodes: ['missing'] },
        },
      ],
    })
    expect(() => parseJson(input)).toThrow('unknown body node: missing')
  })

  it('should throw on switch referencing unknown target node', () => {
    const input = makeMinimalInput({
      nodes: [
        {
          id: 'sw1',
          type: 'switch',
          name: 'Switch',
          switch: {
            expression: '${val}',
            cases: [{ value: 'a', targetNode: 'missing' }],
          },
        },
      ],
    })
    expect(() => parseJson(input)).toThrow('unknown target node: missing')
  })

  it('should accept switch case with default value', () => {
    const input = makeMinimalInput({
      nodes: [
        { id: 'n1', type: 'task', name: 'Task 1', task: { persona: 'coder', prompt: 'do' } },
        {
          id: 'sw1',
          type: 'switch',
          name: 'Switch',
          switch: {
            expression: '${val}',
            cases: [{ value: 'default', targetNode: 'does-not-matter' }],
          },
        },
      ],
    })
    // default cases skip the nodeIds check
    expect(() => parseJson(input)).not.toThrow()
  })

  it('should parse string JSON input', () => {
    const jsonString = JSON.stringify(makeMinimalInput())
    const wf = parseJson(jsonString)
    expect(wf.name).toBe('test-workflow')
  })

  it('should throw on invalid JSON string', () => {
    expect(() => parseJson('not json')).toThrow('Invalid JSON')
  })

  it('should pass through optional fields', () => {
    const input = makeMinimalInput({
      description: 'test desc',
      version: '1.0',
      variables: { key: 'value' },
    })
    const wf = parseJson(input)
    expect(wf.description).toBe('test desc')
    expect(wf.version).toBe('1.0')
    expect(wf.variables).toEqual({ key: 'value' })
  })

  it('should set sourceFile when provided', () => {
    const wf = parseJson(makeMinimalInput(), '/path/to/workflow.json')
    expect(wf.sourceFile).toBe('/path/to/workflow.json')
  })
})

describe('validateJsonWorkflow', () => {
  it('should validate correct workflow', () => {
    const result = validateJsonWorkflow({
      name: 'test',
      nodes: [{ id: 'n1', type: 'task', name: 'Task', task: {} }],
      edges: [{ from: 'n1', to: 'n2' }],
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should reject non-object input', () => {
    expect(validateJsonWorkflow(null).valid).toBe(false)
    expect(validateJsonWorkflow('string').valid).toBe(false)
    expect(validateJsonWorkflow(42).valid).toBe(false)
  })

  it('should report missing name', () => {
    const result = validateJsonWorkflow({ nodes: [] })
    expect(result.errors).toContain('Missing or invalid "name" field')
  })

  it('should report missing nodes', () => {
    const result = validateJsonWorkflow({ name: 'test' })
    expect(result.errors).toContain('Missing or invalid "nodes" array')
  })

  it('should report node missing id', () => {
    const result = validateJsonWorkflow({
      name: 'test',
      nodes: [{ type: 'task', name: 'Task' }],
    })
    expect(result.errors.some(e => e.includes('missing "id"'))).toBe(true)
  })

  it('should report node missing type', () => {
    const result = validateJsonWorkflow({
      name: 'test',
      nodes: [{ id: 'n1', name: 'Task' }],
    })
    expect(result.errors.some(e => e.includes('missing "type"'))).toBe(true)
  })

  it('should report task node missing task config', () => {
    const result = validateJsonWorkflow({
      name: 'test',
      nodes: [{ id: 'n1', type: 'task', name: 'Task' }],
    })
    expect(result.errors.some(e => e.includes('missing "task" config'))).toBe(true)
  })

  it('should validate special node types require config', () => {
    const types = ['delay', 'schedule', 'loop', 'switch', 'assign', 'script', 'foreach']
    for (const type of types) {
      const result = validateJsonWorkflow({
        name: 'test',
        nodes: [{ id: 'n1', type, name: 'Node' }],
      })
      expect(result.errors.some(e => e.includes(`missing "${type}" config`))).toBe(true)
    }
  })

  it('should report invalid edges', () => {
    const result = validateJsonWorkflow({
      name: 'test',
      nodes: [{ id: 'n1', type: 'start', name: 'Start' }],
      edges: [{ to: 'n1' }], // missing from
    })
    expect(result.errors.some(e => e.includes('missing "from"'))).toBe(true)
  })

  it('should reject non-array edges', () => {
    const result = validateJsonWorkflow({
      name: 'test',
      nodes: [{ id: 'n1', type: 'start', name: 'Start' }],
      edges: 'not-array',
    })
    expect(result.errors).toContain('"edges" must be an array')
  })
})

describe('extractJson', () => {
  it('should extract JSON from code block', () => {
    const response = `Here is the workflow:
\`\`\`json
{"name": "test", "nodes": [{"id": "n1", "type": "task", "name": "T"}], "edges": []}
\`\`\`
That's the workflow.`

    const result = extractJson(response)
    expect(result.name).toBe('test')
  })

  it('should extract JSON from code block without language tag', () => {
    const response = `\`\`\`
{"name": "test", "nodes": [], "edges": []}
\`\`\``

    const result = extractJson(response)
    expect(result.name).toBe('test')
  })

  it('should parse raw JSON starting with {', () => {
    const response = '{"name": "test", "nodes": [], "edges": []}'
    const result = extractJson(response)
    expect(result.name).toBe('test')
  })

  it('should find JSON embedded in text', () => {
    const response = 'Some text before {"name": "embedded", "nodes": [], "edges": []} and after'
    const result = extractJson(response)
    expect(result.name).toBe('embedded')
  })

  it('should handle nested braces in embedded JSON', () => {
    const response = 'prefix {"name": "nested", "nodes": [{"id": "n1", "type": "task", "name": "T"}], "edges": []} suffix'
    const result = extractJson(response)
    expect(result.name).toBe('nested')
  })

  it('should throw when no JSON found', () => {
    expect(() => extractJson('no json here at all')).toThrow('No valid JSON found')
  })

  it('should throw on malformed JSON', () => {
    expect(() => extractJson('{invalid json}')).toThrow('Invalid JSON')
  })
})
