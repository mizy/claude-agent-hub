/**
 * Task Log Store - Task 的执行日志和步骤输出
 */

import { existsSync, mkdirSync } from 'fs'
import {
  createLogger,
  formatFileLogLine,
  formatISOTimestamp,
  stripAnsi,
  type LogLevel,
} from '../shared/logger.js'
import {
  getTaskLogsDir,
  getExecutionLogPath,
  getConversationLogFilePath,
  getConversationJsonlPath,
  getJsonlLogPath,
  getResultFilePath,
} from './paths.js'
import { appendToFile } from './readWriteJson.js'

const logger = createLogger('task-log-store')

// ============ Conversation Logging ============

export interface ConversationEntry {
  timestamp: string
  phase: 'planning' | 'executing'
  nodeId?: string
  nodeName?: string
  prompt: string
  response: string
  durationMs: number
  /** API 耗时毫秒数 */
  durationApiMs?: number
  /** 花费 USD */
  costUsd?: number
}

// Append conversation entry to task logs
export function appendConversation(taskId: string, entry: ConversationEntry): void {
  const logDir = getTaskLogsDir(taskId)
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }

  // 1. 写入人类可读的文本格式 (conversation.log)
  const logPath = getConversationLogFilePath(taskId)
  const separator = '\n' + '='.repeat(80) + '\n'

  const metaLines = [
    `[${entry.timestamp}] Phase: ${entry.phase}`,
    entry.nodeId ? `Node: ${entry.nodeId} (${entry.nodeName || 'unnamed'})` : '',
    `Duration: ${entry.durationMs}ms`,
    entry.durationApiMs != null ? `API Duration: ${entry.durationApiMs}ms` : '',
    entry.costUsd != null ? `Cost: $${entry.costUsd.toFixed(6)}` : '',
  ].filter(Boolean)

  const logContent = [
    separator,
    ...metaLines,
    '',
    '--- PROMPT ---',
    entry.prompt,
    '',
    '--- RESPONSE ---',
    entry.response,
    separator,
  ].join('\n')

  appendToFile(logPath, logContent)

  // 2. 写入结构化的 JSONL 格式 (conversation.jsonl)
  const jsonlPath = getConversationJsonlPath(taskId)
  const jsonlLine = JSON.stringify(entry) + '\n'
  appendToFile(jsonlPath, jsonlLine)

  logger.debug(`Logged conversation for task ${taskId}`)
}

// Get conversation log path
export function getConversationLogPath(taskId: string): string {
  return getConversationLogFilePath(taskId)
}

// ============ Execution Log (for stop/resume/events) ============

export interface ExecutionLogOptions {
  /** 日志级别，默认 info */
  level?: Exclude<LogLevel, 'silent'>
  /** 日志 scope，如 lifecycle、node、stream */
  scope?: string
  /** 是否为原始流式输出（不添加时间戳和格式） */
  raw?: boolean
}

/**
 * Append a log entry to the execution log
 * Used for tracking stop/resume and other lifecycle events
 *
 * 日志格式: ISO 8601 时间戳 + 级别 + [scope] + 消息
 * 示例: 2026-02-01T13:02:47.739Z INF [lifecycle] Task resumed
 */
export function appendExecutionLog(
  taskId: string,
  message: string,
  options: ExecutionLogOptions = {}
): void {
  const logPath = getExecutionLogPath(taskId)
  const logDir = getTaskLogsDir(taskId)

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }

  const { level = 'info', scope = '', raw = false } = options

  let logLine: string
  if (raw) {
    // 原始流式输出：只移除 ANSI 颜色码，不添加格式
    logLine = stripAnsi(message)
  } else {
    // 结构化日志：使用统一格式
    logLine = formatFileLogLine(level, scope, message) + '\n'
  }

  appendToFile(logPath, logLine)
}

// ============ JSON Lines 结构化日志 ============

/** JSON Lines 日志事件类型 */
export type LogEventType =
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_paused'
  | 'task_resumed'
  | 'task_stopped'
  | 'node_started'
  | 'node_completed'
  | 'node_failed'
  | 'node_retrying'
  | 'node_injected'
  | 'workflow_generated'
  | 'custom'

/** JSON Lines 日志条目 */
export interface JsonlLogEntry {
  timestamp: string
  event: LogEventType
  taskId: string
  nodeId?: string
  nodeName?: string
  message?: string
  data?: Record<string, unknown>
  durationMs?: number
  error?: string
}

/**
 * 追加 JSON Lines 格式的结构化日志
 *
 * JSON Lines 格式每行一个 JSON 对象，便于：
 * - 流式读取和处理
 * - 日志分析工具解析
 * - 追加写入不影响已有数据
 */
export function appendJsonlLog(
  taskId: string,
  entry: Omit<JsonlLogEntry, 'timestamp' | 'taskId'>
): void {
  const logPath = getJsonlLogPath(taskId)
  const logDir = getTaskLogsDir(taskId)

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }

  const fullEntry: JsonlLogEntry = {
    timestamp: formatISOTimestamp(),
    taskId,
    ...entry,
  }

  const logLine = JSON.stringify(fullEntry) + '\n'
  appendToFile(logPath, logLine)
}

// ============ Path Helpers ============

// Get log file path
export function getLogPath(taskId: string): string {
  return getExecutionLogPath(taskId)
}

// Get output file path
export function getOutputPath(taskId: string): string {
  return getResultFilePath(taskId)
}
