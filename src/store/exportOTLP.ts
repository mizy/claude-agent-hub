/**
 * OpenTelemetry Protocol (OTLP) JSON 导出
 *
 * 将内部 Trace/Span 数据转换为 OTLP JSON 格式，
 * 兼容 Jaeger/Zipkin 导入。
 */

import { writeFileSync } from 'fs'
import { ensureDir } from './readWriteJson.js'
import { TASK_PATHS } from './paths.js'
import { getTrace, listTraces } from './TraceStore.js'
import { SPAN_KIND_TO_OTLP, SPAN_STATUS_TO_OTLP } from '../types/trace.js'
import type { Span, Trace, OTLPAttribute } from '../types/trace.js'
import { dirname } from 'path'

/** OTLP export resource span structure */
interface OTLPExport {
  resourceSpans: Array<{
    resource: {
      attributes: OTLPAttribute[]
    }
    scopeSpans: Array<{
      scope: { name: string; version: string }
      spans: Array<{
        traceId: string
        spanId: string
        parentSpanId?: string
        name: string
        kind: number
        startTimeUnixNano: string
        endTimeUnixNano: string
        status: { code: number; message?: string }
        attributes: OTLPAttribute[]
      }>
    }>
  }>
}

/** OTLP SpanKind numeric values */
const OTLP_KIND_NUM: Record<string, number> = {
  SPAN_KIND_INTERNAL: 1,
  SPAN_KIND_SERVER: 2,
  SPAN_KIND_CLIENT: 3,
}

/** OTLP StatusCode numeric values */
const OTLP_STATUS_NUM: Record<string, number> = {
  STATUS_CODE_UNSET: 0,
  STATUS_CODE_OK: 1,
  STATUS_CODE_ERROR: 2,
}

/** Pad hex string to target length */
function padHex(id: string, length: number): string {
  const hex = Buffer.from(id, 'utf-8').toString('hex')
  return hex.padStart(length, '0').slice(0, length)
}

/** Convert ms timestamp to nanosecond string */
function msToNano(ms: number): string {
  return (BigInt(ms) * BigInt(1_000_000)).toString()
}

/** Convert span attributes to OTLP attributes */
function toOTLPAttributes(attrs: Record<string, unknown>): OTLPAttribute[] {
  const result: OTLPAttribute[] = []
  for (const [key, val] of Object.entries(attrs)) {
    if (val === undefined || val === null) continue
    if (typeof val === 'string') {
      result.push({ key, value: { stringValue: val } })
    } else if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        result.push({ key, value: { intValue: String(val) } })
      } else {
        result.push({ key, value: { doubleValue: val } })
      }
    } else if (typeof val === 'boolean') {
      result.push({ key, value: { boolValue: val } })
    }
  }
  return result
}

/** Convert internal Span to OTLP span format */
function convertSpan(span: Span) {
  const otlpKindStr = SPAN_KIND_TO_OTLP[span.kind]
  const otlpStatusStr = SPAN_STATUS_TO_OTLP[span.status]

  const attrs: OTLPAttribute[] = toOTLPAttributes(span.attributes)

  // Add token usage as attributes
  if (span.tokenUsage) {
    attrs.push({ key: 'llm.token.input', value: { intValue: String(span.tokenUsage.inputTokens) } })
    attrs.push({ key: 'llm.token.output', value: { intValue: String(span.tokenUsage.outputTokens) } })
    attrs.push({ key: 'llm.token.total', value: { intValue: String(span.tokenUsage.totalTokens) } })
  }

  // Add cost as attribute
  if (span.cost) {
    attrs.push({ key: 'cost.amount', value: { doubleValue: span.cost.amount } })
    attrs.push({ key: 'cost.currency', value: { stringValue: span.cost.currency } })
  }

  // Add error as attribute
  if (span.error) {
    attrs.push({ key: 'error.message', value: { stringValue: span.error.message } })
    if (span.error.stack) {
      attrs.push({ key: 'error.stack', value: { stringValue: span.error.stack } })
    }
  }

  return {
    traceId: padHex(span.traceId, 32),
    spanId: padHex(span.spanId, 16),
    ...(span.parentSpanId ? { parentSpanId: padHex(span.parentSpanId, 16) } : {}),
    name: span.name,
    kind: OTLP_KIND_NUM[otlpKindStr] ?? 1,
    startTimeUnixNano: msToNano(span.startTime),
    endTimeUnixNano: msToNano(span.endTime ?? span.startTime),
    status: {
      code: OTLP_STATUS_NUM[otlpStatusStr] ?? 0,
      ...(span.error ? { message: span.error.message } : {}),
    },
    attributes: attrs,
  }
}

/** Convert a Trace to OTLP JSON export format */
export function traceToOTLP(trace: Trace): OTLPExport {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'claude-agent-hub' } },
            { key: 'task.id', value: { stringValue: trace.taskId } },
            { key: 'trace.id', value: { stringValue: trace.traceId } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'cah-tracing', version: '0.1.0' },
            spans: trace.spans.map(convertSpan),
          },
        ],
      },
    ],
  }
}

/** Export all traces for a task to OTLP JSON file */
export function exportTraceToOTLP(taskId: string, outputPath?: string): string | null {
  const traceIds = listTraces(taskId)
  if (traceIds.length === 0) return null

  // Merge all traces into one export
  const allSpans: Span[] = []
  let firstTrace: Trace | null = null

  for (const traceId of traceIds) {
    const trace = getTrace(taskId, traceId)
    if (!trace) continue
    if (!firstTrace) firstTrace = trace
    allSpans.push(...trace.spans)
  }

  if (!firstTrace || allSpans.length === 0) return null

  const mergedTrace: Trace = {
    ...firstTrace,
    spans: allSpans,
    spanCount: allSpans.length,
  }

  const otlp = traceToOTLP(mergedTrace)
  const filePath = outputPath ?? TASK_PATHS.getTracesDir(taskId) + '/otlp-export.json'

  ensureDir(dirname(filePath))
  writeFileSync(filePath, JSON.stringify(otlp, null, 2))

  return filePath
}
