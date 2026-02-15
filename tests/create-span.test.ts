/**
 * createSpan 单元测试
 *
 * 测试 Span 创建工具函数：root span、child span、endSpan
 */

import { describe, it, expect, vi } from 'vitest'
import { spanId, createRootSpan, createChildSpan, endSpan } from '../src/store/createSpan.js'
import type { Span, SpanError } from '../src/types/trace.js'

describe('createSpan', () => {
  describe('spanId', () => {
    it('should generate 8-character ID', () => {
      const id = spanId()
      expect(id).toHaveLength(8)
    })

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => spanId()))
      expect(ids.size).toBe(100)
    })
  })

  describe('createRootSpan', () => {
    it('should create root span with correct fields', () => {
      const now = Date.now()
      const span = createRootSpan('trace-1', 'workflow:execute', 'workflow', {
        'task.id': 't-1',
        'workflow.name': 'test-workflow',
      })

      expect(span.traceId).toBe('trace-1')
      expect(span.spanId).toHaveLength(8)
      expect(span.parentSpanId).toBeUndefined()
      expect(span.name).toBe('workflow:execute')
      expect(span.kind).toBe('workflow')
      expect(span.status).toBe('running')
      expect(span.startTime).toBeGreaterThanOrEqual(now)
      expect(span.startTime).toBeLessThanOrEqual(Date.now())
      expect(span.endTime).toBeUndefined()
      expect(span.durationMs).toBeUndefined()
      expect(span.attributes['task.id']).toBe('t-1')
      expect(span.attributes['workflow.name']).toBe('test-workflow')
    })

    it('should use default kind and attributes', () => {
      const span = createRootSpan('trace-2', 'default-span')
      expect(span.kind).toBe('workflow')
      expect(span.attributes).toEqual({})
    })
  })

  describe('createChildSpan', () => {
    it('should create child span inheriting traceId from parent', () => {
      const parent = createRootSpan('trace-3', 'parent', 'workflow')
      const child = createChildSpan(parent, 'node:analyze', 'node', {
        'node.id': 'n-1',
      })

      expect(child.traceId).toBe('trace-3') // inherited
      expect(child.spanId).toHaveLength(8)
      expect(child.spanId).not.toBe(parent.spanId) // unique
      expect(child.parentSpanId).toBe(parent.spanId) // linked
      expect(child.name).toBe('node:analyze')
      expect(child.kind).toBe('node')
      expect(child.status).toBe('running')
      expect(child.attributes['node.id']).toBe('n-1')
    })

    it('should create nested child spans correctly', () => {
      const root = createRootSpan('trace-4', 'workflow', 'workflow')
      const node = createChildSpan(root, 'node', 'node')
      const llm = createChildSpan(node, 'llm:claude', 'llm')

      expect(root.parentSpanId).toBeUndefined()
      expect(node.parentSpanId).toBe(root.spanId)
      expect(llm.parentSpanId).toBe(node.spanId)

      // All share same traceId
      expect(root.traceId).toBe('trace-4')
      expect(node.traceId).toBe('trace-4')
      expect(llm.traceId).toBe('trace-4')

      // All have unique spanIds
      const ids = new Set([root.spanId, node.spanId, llm.spanId])
      expect(ids.size).toBe(3)
    })
  })

  describe('endSpan', () => {
    it('should set endTime, durationMs, and status ok', () => {
      const span = createRootSpan('trace-5', 'test')
      // Small delay to ensure durationMs > 0
      const ended = endSpan(span)

      expect(ended.endTime).toBeDefined()
      expect(ended.endTime).toBeGreaterThanOrEqual(span.startTime)
      expect(ended.durationMs).toBeDefined()
      expect(ended.durationMs).toBe(ended.endTime! - ended.startTime)
      expect(ended.status).toBe('ok')
      expect(ended.error).toBeUndefined()
    })

    it('should set status error and error info when result has error', () => {
      const span = createRootSpan('trace-6', 'failing')
      const error: SpanError = {
        message: 'Connection refused',
        stack: 'Error: Connection refused\n    at ...',
        category: 'transient',
      }

      const ended = endSpan(span, { error })

      expect(ended.status).toBe('error')
      expect(ended.error).toEqual(error)
      expect(ended.durationMs).toBeDefined()
    })

    it('should set status ok when result has no error', () => {
      const span = createRootSpan('trace-7', 'success')
      const ended = endSpan(span, {})

      expect(ended.status).toBe('ok')
      expect(ended.error).toBeUndefined()
    })

    it('should not mutate the original span', () => {
      const span = createRootSpan('trace-8', 'immutable')
      const ended = endSpan(span)

      expect(span.endTime).toBeUndefined()
      expect(span.durationMs).toBeUndefined()
      expect(span.status).toBe('running')
      expect(ended.status).toBe('ok')
    })

    it('should preserve all original span fields', () => {
      const span = createRootSpan('trace-9', 'preserve', 'node', {
        'node.id': 'n-1',
        'node.name': 'analyze',
      })

      const ended = endSpan(span)

      expect(ended.traceId).toBe('trace-9')
      expect(ended.spanId).toBe(span.spanId)
      expect(ended.name).toBe('preserve')
      expect(ended.kind).toBe('node')
      expect(ended.startTime).toBe(span.startTime)
      expect(ended.attributes['node.id']).toBe('n-1')
    })

    it('should calculate durationMs accurately', () => {
      const startTime = 1000
      const span: Span = {
        traceId: 'trace-10',
        spanId: 'span-calc',
        name: 'calc',
        kind: 'llm',
        startTime,
        status: 'running',
        attributes: {},
      }

      // Mock Date.now to control endTime
      const mockNow = vi.spyOn(Date, 'now').mockReturnValue(3500)
      const ended = endSpan(span)
      mockNow.mockRestore()

      expect(ended.endTime).toBe(3500)
      expect(ended.durationMs).toBe(2500)
    })
  })
})
