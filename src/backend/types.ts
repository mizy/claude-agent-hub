/**
 * Backend 类型定义
 *
 * CLI 后端抽象接口，所有后端适配器必须实现 BackendAdapter
 */

import type { Result } from '../shared/result.js'
import type { PersonaConfig } from '../types/persona.js'
import type { TraceContext } from '../types/trace.js'

// ============ Invoke Types ============

export interface InvokeOptions {
  prompt: string
  mode?: 'plan' | 'execute' | 'review'
  persona?: PersonaConfig
  cwd?: string
  /** 实时输出响应，默认 false */
  stream?: boolean
  /** 跳过权限确认，默认 true */
  skipPermissions?: boolean
  /** 超时毫秒数，默认 30 分钟 */
  timeoutMs?: number
  /** 流式输出回调 */
  onChunk?: (chunk: string) => void
  /** 禁用 MCP 服务器，加速启动，默认 false */
  disableMcp?: boolean
  /** 选择性启用的 MCP 服务器列表（与 disableMcp 配合：disableMcp=true 时只加载这些） */
  mcpServers?: string[]
  /** 复用已有会话 ID，加速连续任务 */
  sessionId?: string
  /** 模型选择，含义因后端而异 */
  model?: string
  /** Trace 上下文，用于创建 LLM child span */
  traceCtx?: TraceContext
  /** Abort signal for cancelling the invocation */
  signal?: AbortSignal
}

export interface InvokeResult {
  prompt: string
  response: string
  durationMs: number
  /** 会话 ID，不支持的后端返回空字符串 */
  sessionId: string
  /** API 耗时毫秒数，不支持的后端为 undefined */
  durationApiMs?: number
  /** 总花费 USD，不支持的后端为 undefined */
  costUsd?: number
  /** 等待并发槽位的毫秒数 */
  slotWaitMs?: number
  /** MCP 工具产生的本地图片路径（如截图），由 chatHandler 直接发送 */
  mcpImagePaths?: string[]
}

export type InvokeError =
  | { type: 'timeout'; message: string }
  | { type: 'process'; message: string; exitCode?: number }
  | { type: 'cancelled'; message: string }

// ============ Backend Adapter ============

/** 后端能力标志 */
export interface BackendCapabilities {
  supportsStreaming: boolean
  supportsSessionReuse: boolean
  supportsCostTracking: boolean
  supportsMcpConfig: boolean
  supportsAgentTeams: boolean
}

/** CLI 后端适配器接口 */
export interface BackendAdapter {
  /** 后端唯一标识，如 'claude-code', 'opencode', 'iflow' */
  readonly name: string

  /** 显示名称 */
  readonly displayName: string

  /** CLI 可执行文件名 */
  readonly cliBinary: string

  /** 能力标志 */
  readonly capabilities: BackendCapabilities

  /** 执行 prompt 并返回结果 */
  invoke(options: InvokeOptions): Promise<Result<InvokeResult, InvokeError>>

  /** 检查 CLI 是否已安装可用 */
  checkAvailable(): Promise<boolean>
}
