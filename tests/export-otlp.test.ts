/**
 * exportOTLP 单元测试
 *
 * 测试 OTLP JSON 导出格式和 span 关系映射
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { traceToOTLP, exportTraceToOTLP } from '../src/store/exportOTLP.js'
import { appendSpan, getTrace } from '../src/store/TraceStore.js'
import { TASK_PATHS, TASKS_DIR } from '../src/store/paths.js'
import type { Trace, Span } from '../src/types/trace.js'

const TEST_PREFIX = `test-otlp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

function makeTaskId(suffix: string): string {
  return `${TEST_PREFIX}-${suffix}`
}

function makeSpan(overrides: Partial<Span> = {}): Span {
  return {
    traceId: 'trace-1',
    spanId: 'span-1',
    name: 'test',
    kind: 'workflow',
    startTime: 1700000000000,
    status: 'ok',
    attributes: {},
    ...overrides,
  }
}

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    traceId: 'trace-1',
    taskId: 'task-1',
    instanceId: 'inst-1',
    rootSpanId: 'span-root',
    spans: [],
    status: 'ok',
    totalDurationMs: 0,
    totalTokens: 0,
    totalCost: 0,
    spanCount: 0,
    llmCallCount: 0,
    ...overrides,
  }
}

describe('exportOTLP', () => {
  describe('traceToOTLP', () => {
    it('should produce valid OTLP resource spans structure', () => {
      const trace = makeTrace({
        spans: [makeSpan({ spanId: 'sp-1', name: 'root' })],
        spanCount: 1,
      })

      const otlp = traceToOTLP(trace)

      expect(otlp.resourceSpans).toHaveLength(1)
      const rs = otlp.resourceSpans[0]

      // Resource attributes
      const attrs = rs.resource.attributes
      expect(attrs).toContainEqual({ key: 'service.name', value: { stringValue: 'claude-agent-hub' } })
      expect(attrs).toContainEqual({ key: 'task.id', value: { stringValue: 'task-1' } })
      expect(attrs).toContainEqual({ key: 'trace.id', value: { stringValue: 'trace-1' } })

      // Scope
      expect(rs.scopeSpans).toHaveLength(1)
      expect(rs.scopeSpans[0].scope.name).toBe('cah-tracing')
      expect(rs.scopeSpans[0].scope.version).toBe('0.1.0')

      // Spans
      expect(rs.scopeSpans[0].spans).toHaveLength(1)
    })

    it('should map span kind correctly', () => {
      const spans: Span[] = [
        makeSpan({ spanId: 'wf', name: 'wf-span', kind: 'workflow' }),
        makeSpan({ spanId: 'nd', name: 'nd-span', kind: 'node' }),
        makeSpan({ spanId: 'llm', name: 'llm-span', kind: 'llm' }),
        makeSpan({ spanId: 'tl', name: 'tl-span', kind: 'tool' }),
        makeSpan({ spanId: 'int', name: 'int-span', kind: 'internal' }),
      ]

      const otlp = traceToOTLP(makeTrace({ spans, spanCount: 5 }))
      const otlpSpans = otlp.resourceSpans[0].scopeSpans[0].spans

      // workflow -> INTERNAL (1), node -> INTERNAL (1), llm -> CLIENT (3), tool -> SERVER (2), internal -> INTERNAL (1)
      expect(otlpSpans.find(s => s.name === 'wf-span')!.kind).toBe(1)   // INTERNAL
      expect(otlpSpans.find(s => s.name === 'nd-span')!.kind).toBe(1)   // INTERNAL
      expect(otlpSpans.find(s => s.name === 'llm-span')!.kind).toBe(3)  // CLIENT
      expect(otlpSpans.find(s => s.name === 'tl-span')!.kind).toBe(2)   // SERVER
      expect(otlpSpans.find(s => s.name === 'int-span')!.kind).toBe(1)  // INTERNAL
    })

    it('should map span status correctly', () => {
      const spans: Span[] = [
        makeSpan({ spanId: 'ok', name: 'ok-span', status: 'ok' }),
        makeSpan({ spanId: 'err', name: 'err-span', status: 'error', error: { message: 'fail' } }),
        makeSpan({ spanId: 'run', name: 'run-span', status: 'running' }),
      ]

      const otlp = traceToOTLP(makeTrace({ spans, spanCount: 3 }))
      const otlpSpans = otlp.resourceSpans[0].scopeSpans[0].spans

      // ok -> STATUS_CODE_OK (1), error -> STATUS_CODE_ERROR (2), running -> STATUS_CODE_UNSET (0)
      expect(otlpSpans.find(s => s.name === 'ok-span')!.status.code).toBe(1)
      const errSpan = otlpSpans.find(s => s.name === 'err-span')!
      expect(errSpan.status.code).toBe(2)
      expect(errSpan.status.message).toBe('fail')
      expect(otlpSpans.find(s => s.name === 'run-span')!.status.code).toBe(0)
    })

    it('should pad traceId to 32 hex chars and spanId to 16 hex chars', () => {
      const span = makeSpan({ traceId: 'abc', spanId: 'xy' })
      const otlp = traceToOTLP(makeTrace({ traceId: 'abc', spans: [span], spanCount: 1 }))
      const otlpSpan = otlp.resourceSpans[0].scopeSpans[0].spans[0]

      expect(otlpSpan.traceId).toHaveLength(32)
      expect(otlpSpan.spanId).toHaveLength(16)
    })

    it('should convert timestamps to nanoseconds', () => {
      const span = makeSpan({ startTime: 1700000000000, endTime: 1700000005000 })
      const otlp = traceToOTLP(makeTrace({ spans: [span], spanCount: 1 }))
      const otlpSpan = otlp.resourceSpans[0].scopeSpans[0].spans[0]

      // 1700000000000 ms * 1_000_000 = "1700000000000000000" ns
      expect(otlpSpan.startTimeUnixNano).toBe('1700000000000000000')
      expect(otlpSpan.endTimeUnixNano).toBe('1700000005000000000')
    })

    it('should use startTime as endTime when endTime is undefined', () => {
      const span = makeSpan({ startTime: 1700000000000 })
      const otlp = traceToOTLP(makeTrace({ spans: [span], spanCount: 1 }))
      const otlpSpan = otlp.resourceSpans[0].scopeSpans[0].spans[0]

      expect(otlpSpan.startTimeUnixNano).toBe(otlpSpan.endTimeUnixNano)
    })

    it('should include parentSpanId only when present', () => {
      const root = makeSpan({ spanId: 'root-1', name: 'root-span' })
      const child = makeSpan({ spanId: 'child-1', name: 'child-span', parentSpanId: 'root-1' })

      const otlp = traceToOTLP(makeTrace({ spans: [root, child], spanCount: 2 }))
      const otlpSpans = otlp.resourceSpans[0].scopeSpans[0].spans

      const otlpRoot = otlpSpans.find(s => s.name === 'root-span')!
      const otlpChild = otlpSpans.find(s => s.name === 'child-span')!

      expect(otlpRoot.parentSpanId).toBeUndefined()
      expect(otlpChild.parentSpanId).toBeDefined()
      expect(otlpChild.parentSpanId).toHaveLength(16) // hex padded
    })

    it('should include token usage as attributes', () => {
      const span = makeSpan({
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      })

      const otlp = traceToOTLP(makeTrace({ spans: [span], spanCount: 1 }))
      const attrs = otlp.resourceSpans[0].scopeSpans[0].spans[0].attributes

      expect(attrs).toContainEqual({ key: 'llm.token.input', value: { intValue: '100' } })
      expect(attrs).toContainEqual({ key: 'llm.token.output', value: { intValue: '50' } })
      expect(attrs).toContainEqual({ key: 'llm.token.total', value: { intValue: '150' } })
    })

    it('should include cost as attributes', () => {
      const span = makeSpan({
        cost: { amount: 0.025, currency: 'USD' },
      })

      const otlp = traceToOTLP(makeTrace({ spans: [span], spanCount: 1 }))
      const attrs = otlp.resourceSpans[0].scopeSpans[0].spans[0].attributes

      expect(attrs).toContainEqual({ key: 'cost.amount', value: { doubleValue: 0.025 } })
      expect(attrs).toContainEqual({ key: 'cost.currency', value: { stringValue: 'USD' } })
    })

    it('should include error as attributes', () => {
      const span = makeSpan({
        status: 'error',
        error: { message: 'timeout', stack: 'Error: timeout\n  at fn()' },
      })

      const otlp = traceToOTLP(makeTrace({ spans: [span], spanCount: 1 }))
      const attrs = otlp.resourceSpans[0].scopeSpans[0].spans[0].attributes

      expect(attrs).toContainEqual({ key: 'error.message', value: { stringValue: 'timeout' } })
      expect(attrs).toContainEqual({ key: 'error.stack', value: { stringValue: 'Error: timeout\n  at fn()' } })
    })

    it('should convert span attributes to OTLP format', () => {
      const span = makeSpan({
        attributes: {
          'task.id': 'task-123',
          'llm.duration_api_ms': 1500,
          'llm.model': 'claude-opus',
        },
      })

      const otlp = traceToOTLP(makeTrace({ spans: [span], spanCount: 1 }))
      const attrs = otlp.resourceSpans[0].scopeSpans[0].spans[0].attributes

      expect(attrs).toContainEqual({ key: 'task.id', value: { stringValue: 'task-123' } })
      expect(attrs).toContainEqual({ key: 'llm.duration_api_ms', value: { intValue: '1500' } })
      expect(attrs).toContainEqual({ key: 'llm.model', value: { stringValue: 'claude-opus' } })
    })
  })

  describe('exportTraceToOTLP', () => {
    const taskId = makeTaskId('export')
    const traceId = 'tr-export'

    beforeAll(() => {
      mkdirSync(TASK_PATHS.getDir(taskId), { recursive: true })

      appendSpan(taskId, makeSpan({
        traceId,
        spanId: 'root',
        name: 'workflow:test',
        kind: 'workflow',
        durationMs: 5000,
        endTime: 1700000005000,
      }))
      appendSpan(taskId, makeSpan({
        traceId,
        spanId: 'llm-1',
        parentSpanId: 'root',
        name: 'llm:claude',
        kind: 'llm',
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }))
    })

    it('should export to file and return file path', () => {
      const outputPath = join(TASK_PATHS.getTracesDir(taskId), 'test-export.json')
      const result = exportTraceToOTLP(taskId, outputPath)

      expect(result).toBe(outputPath)
      expect(existsSync(outputPath)).toBe(true)

      const content = JSON.parse(readFileSync(outputPath, 'utf-8'))
      expect(content.resourceSpans).toHaveLength(1)
      expect(content.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2)
    })

    it('should return null for task with no traces', () => {
      const result = exportTraceToOTLP(makeTaskId('no-traces'))
      expect(result).toBeNull()
    })

    it('should export valid JSON that roundtrips', () => {
      const outputPath = join(TASK_PATHS.getTracesDir(taskId), 'roundtrip.json')
      exportTraceToOTLP(taskId, outputPath)

      const content = readFileSync(outputPath, 'utf-8')
      const parsed = JSON.parse(content)
      // Should be re-serializable without loss
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
    })

    it('should merge multiple traces into one export', () => {
      const taskIdMulti = makeTaskId('multi')
      mkdirSync(TASK_PATHS.getDir(taskIdMulti), { recursive: true })

      appendSpan(taskIdMulti, makeSpan({ traceId: 'tr-a', spanId: 'sa' }))
      appendSpan(taskIdMulti, makeSpan({ traceId: 'tr-b', spanId: 'sb' }))

      const outputPath = join(TASK_PATHS.getTracesDir(taskIdMulti), 'merged.json')
      const result = exportTraceToOTLP(taskIdMulti, outputPath)

      expect(result).toBe(outputPath)
      const content = JSON.parse(readFileSync(outputPath, 'utf-8'))
      // Both spans should be in one export
      expect(content.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2)
    })
  })
})
