/**
 * TraceStore 单元测试
 *
 * 测试 JSONL 格式的 Span 存储：追加、读取、查询、错误链路
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { appendSpan, getTrace, listTraces, querySlowSpans, getErrorChain } from '../src/store/TraceStore.js'
import { TASK_PATHS, TASKS_DIR } from '../src/store/paths.js'
import type { Span } from '../src/types/trace.js'

const TEST_PREFIX = `test-trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

function makeTaskId(suffix: string): string {
  return `${TEST_PREFIX}-${suffix}`
}

function makeSpan(overrides: Partial<Span> = {}): Span {
  return {
    traceId: 'trace-1',
    spanId: `span-${Math.random().toString(36).slice(2, 8)}`,
    name: 'test-span',
    kind: 'workflow',
    startTime: 1000,
    status: 'ok',
    attributes: {},
    ...overrides,
  }
}

describe('TraceStore', () => {
  const taskId = makeTaskId('basic')
  const traceId = 'trace-basic'

  beforeAll(() => {
    // Ensure task dir exists
    mkdirSync(TASK_PATHS.getDir(taskId), { recursive: true })
  })

  describe('appendSpan', () => {
    it('should create JSONL file and append span', () => {
      const span = makeSpan({ traceId, spanId: 'span-001', name: 'root' })
      appendSpan(taskId, span)

      const filePath = TASK_PATHS.getTraceFilePath(taskId, traceId)
      expect(existsSync(filePath)).toBe(true)

      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0])).toMatchObject({ spanId: 'span-001', name: 'root' })
    })

    it('should append multiple spans to same JSONL file', () => {
      const span2 = makeSpan({ traceId, spanId: 'span-002', name: 'child-1', parentSpanId: 'span-001' })
      const span3 = makeSpan({ traceId, spanId: 'span-003', name: 'child-2', parentSpanId: 'span-001' })
      appendSpan(taskId, span2)
      appendSpan(taskId, span3)

      const filePath = TASK_PATHS.getTraceFilePath(taskId, traceId)
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      expect(lines).toHaveLength(3)
    })
  })

  describe('getTrace', () => {
    it('should assemble Trace from JSONL file', () => {
      const trace = getTrace(taskId, traceId)
      expect(trace).not.toBeNull()
      expect(trace!.traceId).toBe(traceId)
      expect(trace!.taskId).toBe(taskId)
      expect(trace!.spans).toHaveLength(3)
      expect(trace!.spanCount).toBe(3)
      expect(trace!.rootSpanId).toBe('span-001')
    })

    it('should return null for non-existent trace', () => {
      const trace = getTrace(taskId, 'non-existent')
      expect(trace).toBeNull()
    })

    it('should aggregate token usage and cost', () => {
      const taskId2 = makeTaskId('aggregate')
      mkdirSync(TASK_PATHS.getDir(taskId2), { recursive: true })

      const root = makeSpan({
        traceId: 'trace-agg',
        spanId: 'root',
        name: 'workflow',
        kind: 'workflow',
        durationMs: 5000,
      })
      const llm1 = makeSpan({
        traceId: 'trace-agg',
        spanId: 'llm-1',
        parentSpanId: 'root',
        name: 'llm:claude',
        kind: 'llm',
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        cost: { amount: 0.01, currency: 'USD' },
      })
      const llm2 = makeSpan({
        traceId: 'trace-agg',
        spanId: 'llm-2',
        parentSpanId: 'root',
        name: 'llm:claude',
        kind: 'llm',
        tokenUsage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
        cost: { amount: 0.02, currency: 'USD' },
      })

      appendSpan(taskId2, root)
      appendSpan(taskId2, llm1)
      appendSpan(taskId2, llm2)

      const trace = getTrace(taskId2, 'trace-agg')!
      expect(trace.totalTokens).toBe(450)
      expect(trace.totalCost).toBeCloseTo(0.03)
      expect(trace.llmCallCount).toBe(2)
      expect(trace.totalDurationMs).toBe(5000)
    })

    it('should determine status correctly — error takes precedence', () => {
      const taskId3 = makeTaskId('status-err')
      mkdirSync(TASK_PATHS.getDir(taskId3), { recursive: true })

      appendSpan(taskId3, makeSpan({ traceId: 'trace-err', spanId: 'r', status: 'ok' }))
      appendSpan(taskId3, makeSpan({ traceId: 'trace-err', spanId: 'e', parentSpanId: 'r', status: 'error' }))

      const trace = getTrace(taskId3, 'trace-err')!
      expect(trace.status).toBe('error')
    })

    it('should determine status correctly — running if any running', () => {
      const taskId4 = makeTaskId('status-run')
      mkdirSync(TASK_PATHS.getDir(taskId4), { recursive: true })

      appendSpan(taskId4, makeSpan({ traceId: 'trace-run', spanId: 'r', status: 'ok' }))
      appendSpan(taskId4, makeSpan({ traceId: 'trace-run', spanId: 'c', parentSpanId: 'r', status: 'running' }))

      const trace = getTrace(taskId4, 'trace-run')!
      expect(trace.status).toBe('running')
    })
  })

  describe('listTraces', () => {
    it('should list all trace IDs for a task', () => {
      const taskId5 = makeTaskId('list')
      mkdirSync(TASK_PATHS.getDir(taskId5), { recursive: true })

      appendSpan(taskId5, makeSpan({ traceId: 'alpha', spanId: 's1' }))
      appendSpan(taskId5, makeSpan({ traceId: 'beta', spanId: 's2' }))
      appendSpan(taskId5, makeSpan({ traceId: 'gamma', spanId: 's3' }))

      const ids = listTraces(taskId5)
      expect(ids).toHaveLength(3)
      expect(ids.sort()).toEqual(['alpha', 'beta', 'gamma'])
    })

    it('should return empty array for non-existent task', () => {
      expect(listTraces('non-existent-task-xyz')).toEqual([])
    })
  })

  describe('querySlowSpans', () => {
    const taskIdSlow = makeTaskId('slow')

    beforeAll(() => {
      mkdirSync(TASK_PATHS.getDir(taskIdSlow), { recursive: true })

      appendSpan(taskIdSlow, makeSpan({ traceId: 'tr-slow', spanId: 's-fast', durationMs: 100, name: 'fast' }))
      appendSpan(taskIdSlow, makeSpan({ traceId: 'tr-slow', spanId: 's-medium', durationMs: 2000, name: 'medium' }))
      appendSpan(taskIdSlow, makeSpan({ traceId: 'tr-slow', spanId: 's-slow', durationMs: 5000, name: 'slow' }))
      appendSpan(taskIdSlow, makeSpan({ traceId: 'tr-slow', spanId: 's-very-slow', durationMs: 10000, name: 'very-slow' }))
    })

    it('should return spans sorted by duration descending', () => {
      const spans = querySlowSpans(taskIdSlow)
      expect(spans[0].name).toBe('very-slow')
      expect(spans[1].name).toBe('slow')
      expect(spans[2].name).toBe('medium')
      expect(spans[3].name).toBe('fast')
    })

    it('should filter by minDurationMs', () => {
      const spans = querySlowSpans(taskIdSlow, { minDurationMs: 2000 })
      expect(spans).toHaveLength(3)
      expect(spans.every(s => (s.durationMs ?? 0) >= 2000)).toBe(true)
    })

    it('should respect limit', () => {
      const spans = querySlowSpans(taskIdSlow, { limit: 2 })
      expect(spans).toHaveLength(2)
      expect(spans[0].durationMs).toBe(10000)
      expect(spans[1].durationMs).toBe(5000)
    })

    it('should exclude spans without durationMs when minDurationMs > 0', () => {
      const taskIdNoDur = makeTaskId('no-dur')
      mkdirSync(TASK_PATHS.getDir(taskIdNoDur), { recursive: true })

      appendSpan(taskIdNoDur, makeSpan({ traceId: 'tr-nd', spanId: 'running', name: 'running' })) // no durationMs
      appendSpan(taskIdNoDur, makeSpan({ traceId: 'tr-nd', spanId: 'done', durationMs: 500, name: 'done' }))

      const spans = querySlowSpans(taskIdNoDur, { minDurationMs: 100 })
      expect(spans).toHaveLength(1)
      expect(spans[0].name).toBe('done')
    })
  })

  describe('getErrorChain', () => {
    const taskIdErr = makeTaskId('errchain')

    beforeAll(() => {
      mkdirSync(TASK_PATHS.getDir(taskIdErr), { recursive: true })

      // Build a chain: root -> node -> llm (error)
      appendSpan(taskIdErr, makeSpan({
        traceId: 'tr-chain',
        spanId: 'root',
        name: 'workflow',
        kind: 'workflow',
        status: 'ok',
      }))
      appendSpan(taskIdErr, makeSpan({
        traceId: 'tr-chain',
        spanId: 'node-1',
        parentSpanId: 'root',
        name: 'node:analyze',
        kind: 'node',
        status: 'ok',
      }))
      appendSpan(taskIdErr, makeSpan({
        traceId: 'tr-chain',
        spanId: 'llm-err',
        parentSpanId: 'node-1',
        name: 'llm:claude',
        kind: 'llm',
        status: 'error',
        error: { message: 'API timeout', category: 'transient' },
      }))
    })

    it('should walk up from error span to root', () => {
      const chain = getErrorChain(taskIdErr, 'llm-err')
      expect(chain).toHaveLength(3)
      expect(chain[0].spanId).toBe('llm-err') // target
      expect(chain[1].spanId).toBe('node-1')  // parent
      expect(chain[2].spanId).toBe('root')    // root
    })

    it('should return single span if querying root', () => {
      const chain = getErrorChain(taskIdErr, 'root')
      expect(chain).toHaveLength(1)
      expect(chain[0].spanId).toBe('root')
    })

    it('should return empty for non-existent span', () => {
      const chain = getErrorChain(taskIdErr, 'non-existent')
      expect(chain).toEqual([])
    })
  })

  describe('JSONL format correctness', () => {
    it('should handle malformed lines gracefully', () => {
      const taskIdMalformed = makeTaskId('malformed')
      mkdirSync(TASK_PATHS.getDir(taskIdMalformed), { recursive: true })

      // Write a valid span first
      appendSpan(taskIdMalformed, makeSpan({ traceId: 'tr-mal', spanId: 'good' }))

      // Manually append a malformed line
      const filePath = TASK_PATHS.getTraceFilePath(taskIdMalformed, 'tr-mal')
      const { appendFileSync } = require('fs')
      appendFileSync(filePath, 'this is not json\n')
      appendFileSync(filePath, '{"incomplete": true\n') // malformed JSON

      // Append another valid span
      appendSpan(taskIdMalformed, makeSpan({ traceId: 'tr-mal', spanId: 'good-2' }))

      const trace = getTrace(taskIdMalformed, 'tr-mal')!
      // Should only have the 2 valid spans, skipping malformed lines
      expect(trace.spans).toHaveLength(2)
      expect(trace.spans.map(s => s.spanId).sort()).toEqual(['good', 'good-2'])
    })
  })

  describe('edge cases', () => {
    it('should handle empty trace (no spans)', () => {
      const trace = getTrace(makeTaskId('empty'), 'no-trace')
      expect(trace).toBeNull()
    })

    it('should handle large number of spans', () => {
      const taskIdLarge = makeTaskId('large')
      mkdirSync(TASK_PATHS.getDir(taskIdLarge), { recursive: true })

      const spanCount = 100
      for (let i = 0; i < spanCount; i++) {
        appendSpan(taskIdLarge, makeSpan({
          traceId: 'tr-large',
          spanId: `span-${i}`,
          name: `span-${i}`,
          parentSpanId: i === 0 ? undefined : 'span-0',
          kind: i === 0 ? 'workflow' : 'node',
          durationMs: i * 10,
        }))
      }

      const trace = getTrace(taskIdLarge, 'tr-large')!
      expect(trace.spanCount).toBe(spanCount)
      expect(trace.rootSpanId).toBe('span-0')
    })
  })
})
