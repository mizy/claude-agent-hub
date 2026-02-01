/**
 * Task Log Store - Task 的执行日志和步骤输出
 */

import { existsSync, mkdirSync } from 'fs'
import { createLogger } from '../shared/logger.js'
import {
  getTaskLogsDir,
  getExecutionLogPath,
  getConversationLogFilePath,
  getResultFilePath,
  getStepFilePath,
} from './paths.js'
import { writeJson, appendToFile } from './json.js'
import { getTaskFolder } from './TaskStore.js'

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

  const logPath = getConversationLogFilePath(taskId)
  const separator = '\n' + '='.repeat(80) + '\n'

  const logContent = [
    separator,
    `[${entry.timestamp}] Phase: ${entry.phase}`,
    entry.nodeId ? `Node: ${entry.nodeId} (${entry.nodeName || 'unnamed'})` : '',
    `Duration: ${entry.durationMs}ms`,
    '',
    '--- PROMPT ---',
    entry.prompt,
    '',
    '--- RESPONSE ---',
    entry.response,
    separator,
  ].filter(Boolean).join('\n')

  appendToFile(logPath, logContent)
  logger.debug(`Logged conversation for task ${taskId}`)
}

// Get conversation log path
export function getConversationLogPath(taskId: string): string {
  return getConversationLogFilePath(taskId)
}

// ============ Execution Log (for stop/resume/events) ============

/**
 * Append a log entry to the execution log
 * Used for tracking stop/resume and other lifecycle events
 */
export function appendExecutionLog(taskId: string, message: string): void {
  const logPath = getExecutionLogPath(taskId)
  const logDir = getTaskLogsDir(taskId)

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }

  const timestamp = new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const logLine = `${timestamp} INF ${message}\n`
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

// ============ Step Records ============

// Save step output
export function saveStepOutput(taskId: string, stepNumber: number, output: unknown): void {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return
  writeJson(getStepFilePath(taskId, stepNumber), output)
}
