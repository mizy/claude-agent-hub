/**
 * Trace Store - JSONL 格式的 Span 存储
 *
 * 每个 trace 对应一个 .jsonl 文件，路径：
 * .cah-data/tasks/task-{id}/traces/trace-{traceId}.jsonl
 *
 * 每行一个 Span JSON 对象，支持追加写入和流式读取。
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { appendToFile, ensureDir } from './readWriteJson.js'
import { TASK_PATHS } from './paths.js'
import type { Span, Trace, SpanStatus } from '../types/trace.js'

const logger = createLogger('trace-store')

// ============ 写入 ============

/** Append a span to the trace JSONL file */
export function appendSpan(taskId: string, span: Span): void {
  const tracesDir = TASK_PATHS.getTracesDir(taskId)
  ensureDir(tracesDir)

  const filePath = TASK_PATHS.getTraceFilePath(taskId, span.traceId)
  const line = JSON.stringify(span) + '\n'
  appendToFile(filePath, line)

  logger.debug(`Appended span ${span.spanId} to trace ${span.traceId}`)
}

// ============ 读取 ============

/** Read all spans of a trace, returns assembled Trace or null */
export function getTrace(taskId: string, traceId: string): Trace | null {
  const filePath = TASK_PATHS.getTraceFilePath(taskId, traceId)
  const spans = readSpansFromFile(filePath)
  if (spans.length === 0) return null

  return assembleTrace(taskId, traceId, spans)
}

/** List all trace IDs for a task */
export function listTraces(taskId: string): string[] {
  const tracesDir = TASK_PATHS.getTracesDir(taskId)
  if (!existsSync(tracesDir)) return []

  const files = readdirSync(tracesDir)
  return files
    .filter(f => f.startsWith('trace-') && f.endsWith('.jsonl'))
    .map(f => f.slice('trace-'.length, -'.jsonl'.length))
}

/** Query slow spans sorted by duration (desc) */
export function querySlowSpans(
  taskId: string,
  options: { minDurationMs?: number; limit?: number } = {}
): Span[] {
  const { minDurationMs = 0, limit = 20 } = options
  const traceIds = listTraces(taskId)
  const allSpans: Span[] = []

  for (const traceId of traceIds) {
    const filePath = TASK_PATHS.getTraceFilePath(taskId, traceId)
    const spans = readSpansFromFile(filePath)
    for (const span of spans) {
      if (span.durationMs != null && span.durationMs >= minDurationMs) {
        allSpans.push(span)
      }
    }
  }

  allSpans.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
  return allSpans.slice(0, limit)
}

/** Trace error chain from a span upward to root */
export function getErrorChain(taskId: string, spanId: string): Span[] {
  const traceIds = listTraces(taskId)

  for (const traceId of traceIds) {
    const filePath = TASK_PATHS.getTraceFilePath(taskId, traceId)
    const spans = readSpansFromFile(filePath)
    const spanMap = new Map(spans.map(s => [s.spanId, s]))

    const target = spanMap.get(spanId)
    if (!target) continue

    // Walk up the parent chain
    const chain: Span[] = [target]
    let current = target
    while (current.parentSpanId) {
      const parent = spanMap.get(current.parentSpanId)
      if (!parent) break
      chain.push(parent)
      current = parent
    }

    return chain
  }

  return []
}

// ============ 内部工具 ============

/** Read spans from a JSONL file */
function readSpansFromFile(filePath: string): Span[] {
  if (!existsSync(filePath)) return []

  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim())
    const spans: Span[] = []

    for (const line of lines) {
      try {
        spans.push(JSON.parse(line) as Span)
      } catch {
        logger.debug(`Skipping malformed JSONL line in ${filePath}`)
      }
    }

    return spans
  } catch (e) {
    logger.debug(`Failed to read trace file: ${filePath} (${getErrorMessage(e)})`)
    return []
  }
}

/** Assemble a Trace aggregate from spans */
function assembleTrace(taskId: string, traceId: string, spans: Span[]): Trace {
  const rootSpan = spans.find(s => !s.parentSpanId)

  let totalTokens = 0
  let totalCost = 0
  let llmCallCount = 0

  for (const span of spans) {
    if (span.tokenUsage) {
      totalTokens += span.tokenUsage.totalTokens
    }
    if (span.cost) {
      totalCost += span.cost.amount
    }
    if (span.kind === 'llm') {
      llmCallCount++
    }
  }

  // Determine overall status
  const hasError = spans.some(s => s.status === 'error')
  const hasRunning = spans.some(s => s.status === 'running')
  let status: SpanStatus = 'ok'
  if (hasError) status = 'error'
  else if (hasRunning) status = 'running'

  const totalDurationMs = rootSpan?.durationMs ?? 0

  return {
    traceId,
    taskId,
    instanceId: (rootSpan?.attributes['instance.id'] as string) ?? '',
    rootSpanId: rootSpan?.spanId ?? '',
    spans,
    status,
    totalDurationMs,
    totalTokens,
    totalCost,
    spanCount: spans.length,
    llmCallCount,
  }
}
