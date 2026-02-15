/**
 * Tracing 类型定义
 *
 * 全链路追踪数据模型，覆盖 task → workflow → node → llm 四层 span。
 * 设计原则：
 * - traceId 直接复用 taskId（一个 task = 一条 trace）
 * - span 层级对应现有执行层级（workflow / node / llm / tool）
 * - 与现有 stats.json / timeline.json 并存，trace.json 为独立文件
 * - 兼容 OpenTelemetry Span 语义，便于未来导出
 */

// ============ Span 基础类型 ============

/** Span 类型：对应执行层级 */
export type SpanKind = 'workflow' | 'node' | 'llm' | 'tool' | 'internal'

/** Span 状态 */
export type SpanStatus = 'running' | 'ok' | 'error'

/** Token 用量 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** 成本信息 */
export interface SpanCost {
  amount: number
  currency: string // 'USD'
}

/** Span 错误信息 */
export interface SpanError {
  message: string
  stack?: string
  category?: 'transient' | 'recoverable' | 'permanent' | 'unknown'
}

/**
 * Span — 追踪系统的基本单元
 *
 * 层级关系：
 * - workflow span (root): 整个工作流执行
 *   - node span: 单个节点执行
 *     - llm span: 一次 LLM 调用（backend.invoke）
 *     - tool span: 工具调用（未来扩展）
 *   - internal span: 内部操作（分析、规划等）
 */
export interface Span {
  traceId: string // 关联到 taskId
  spanId: string // 唯一 span ID
  parentSpanId?: string // 父 span（root span 无此字段）
  name: string // span 名称（如 'workflow:execute', 'node:analyze', 'llm:claude-opus'）
  kind: SpanKind
  startTime: number // Unix timestamp ms
  endTime?: number // 结束时间（running 时为空）
  durationMs?: number // 耗时（endTime - startTime）
  status: SpanStatus

  /** 自定义属性（按 span 类型不同） */
  attributes: SpanAttributes

  /** Token 用量（仅 llm span） */
  tokenUsage?: TokenUsage

  /** 成本（仅 llm span 或聚合到 node/workflow） */
  cost?: SpanCost

  /** 异常信息 */
  error?: SpanError
}

// ============ Span 属性（按类型分） ============

/** 通用属性 + 各类型特有属性 */
export type SpanAttributes = Record<string, unknown> & {
  // 通用关联字段（可选，按需填入）
  'task.id'?: string
  'workflow.id'?: string
  'instance.id'?: string
  'node.id'?: string
  'node.type'?: string
  'node.name'?: string

  // LLM 特有
  'llm.backend'?: string // 'claude-code' | 'opencode' | 'iflow'
  'llm.model'?: string
  'llm.session_id'?: string
  'llm.prompt_length'?: number
  'llm.response_length'?: number
  'llm.duration_api_ms'?: number // 纯 API 耗时
  'llm.slot_wait_ms'?: number // 等待并发槽位耗时

  // Node 特有
  'node.attempt'?: number
  'node.persona'?: string

  // Workflow 特有
  'workflow.name'?: string
  'workflow.total_nodes'?: number
}

// ============ Trace 聚合视图 ============

/**
 * Trace — 一次完整任务执行的追踪聚合
 *
 * 由 traceId (= taskId) 关联所有 span
 */
export interface Trace {
  traceId: string
  taskId: string
  instanceId: string
  rootSpanId: string // workflow span 的 spanId
  spans: Span[]
  status: SpanStatus

  // 聚合指标
  totalDurationMs: number
  totalTokens: number
  totalCost: number // USD
  spanCount: number
  llmCallCount: number
}

// ============ 持久化格式（trace.json） ============

/**
 * trace.json 文件结构
 *
 * 存储在 .cah-data/tasks/task-{id}/trace.json
 */
export interface TraceFile {
  traceId: string
  taskId: string
  instanceId: string
  spans: Span[]
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp
}

// ============ OpenTelemetry 导出映射 ============

/**
 * OTLP Span 映射
 *
 * 将内部 Span 映射到 OpenTelemetry 协议格式
 * 参考: https://opentelemetry.io/docs/specs/otel/trace/api/
 */
export interface OTLPSpanMapping {
  traceId: string // hex string, 32 chars
  spanId: string // hex string, 16 chars
  parentSpanId?: string
  operationName: string
  startTimeUnixNano: string // nanoseconds as string
  endTimeUnixNano?: string
  kind: OTLPSpanKind
  status: OTLPStatus
  attributes: OTLPAttribute[]
}

/** OTLP SpanKind 映射 */
export type OTLPSpanKind =
  | 'SPAN_KIND_INTERNAL' // workflow, internal
  | 'SPAN_KIND_CLIENT' // llm (calling external API)
  | 'SPAN_KIND_SERVER' // tool (processing request)

/** OTLP Status 映射 */
export interface OTLPStatus {
  code: 'STATUS_CODE_UNSET' | 'STATUS_CODE_OK' | 'STATUS_CODE_ERROR'
  message?: string
}

/** OTLP 属性 */
export interface OTLPAttribute {
  key: string
  value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean }
}

/** SpanKind → OTLPSpanKind 映射表 */
export const SPAN_KIND_TO_OTLP: Record<SpanKind, OTLPSpanKind> = {
  workflow: 'SPAN_KIND_INTERNAL',
  node: 'SPAN_KIND_INTERNAL',
  llm: 'SPAN_KIND_CLIENT',
  tool: 'SPAN_KIND_SERVER',
  internal: 'SPAN_KIND_INTERNAL',
}

/** SpanStatus → OTLP StatusCode 映射表 */
export const SPAN_STATUS_TO_OTLP: Record<SpanStatus, OTLPStatus['code']> = {
  running: 'STATUS_CODE_UNSET',
  ok: 'STATUS_CODE_OK',
  error: 'STATUS_CODE_ERROR',
}

// ============ Trace Context（跨层传递） ============

/**
 * TraceContext — 轻量级上下文对象，通过函数参数传递
 *
 * 从 executeNode → executeNodeByType → invokeBackend 的调用链中传递，
 * 允许每层创建 child span 并自动关联到父 span。
 */
export interface TraceContext {
  traceId: string
  taskId: string
  /** 当前层的 span，child span 以此为 parent */
  currentSpan: Span
}

// ============ 辅助函数 ============

export function isSpanRunning(status: SpanStatus): boolean {
  return status === 'running'
}

export function isSpanTerminal(status: SpanStatus): boolean {
  return status === 'ok' || status === 'error'
}

export function isSpanError(status: SpanStatus): boolean {
  return status === 'error'
}

export function isLLMSpan(span: Span): boolean {
  return span.kind === 'llm'
}

export function isNodeSpan(span: Span): boolean {
  return span.kind === 'node'
}
