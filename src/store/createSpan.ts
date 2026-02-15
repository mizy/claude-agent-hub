/**
 * Span 创建和管理工具函数
 *
 * 提供创建 root/child span、结束 span 等操作。
 */

import { generateShortId } from '../shared/generateId.js'
import type { Span, SpanKind, SpanAttributes, SpanError } from '../types/trace.js'

/** Generate a unique span ID */
export function spanId(): string {
  return generateShortId()
}

/** Create a root span (no parent) */
export function createRootSpan(
  traceId: string,
  name: string,
  kind: SpanKind = 'workflow',
  attributes: SpanAttributes = {}
): Span {
  return {
    traceId,
    spanId: spanId(),
    name,
    kind,
    startTime: Date.now(),
    status: 'running',
    attributes,
  }
}

/** Create a child span under a parent */
export function createChildSpan(
  parentSpan: Span,
  name: string,
  kind: SpanKind,
  attributes: SpanAttributes = {}
): Span {
  return {
    traceId: parentSpan.traceId,
    spanId: spanId(),
    parentSpanId: parentSpan.spanId,
    name,
    kind,
    startTime: Date.now(),
    status: 'running',
    attributes,
  }
}

/** End a span, calculating duration and setting status */
export function endSpan(
  span: Span,
  result?: { error?: SpanError }
): Span {
  const endTime = Date.now()
  const durationMs = endTime - span.startTime

  return {
    ...span,
    endTime,
    durationMs,
    status: result?.error ? 'error' : 'ok',
    error: result?.error,
  }
}
