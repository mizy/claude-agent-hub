/**
 * 统一日志系统
 * 支持级别控制、结构化输出
 */

import chalk from 'chalk'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
}

const LEVEL_COLORS: Record<Exclude<LogLevel, 'silent'>, (s: string) => string> = {
  debug: chalk.gray,
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
}

const LEVEL_LABELS: Record<Exclude<LogLevel, 'silent'>, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
}

// 测试环境默认静默，避免测试输出噪音
let currentLevel: LogLevel = process.env.NODE_ENV === 'test' ? 'silent' : 'info'

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel]
}

function formatTime(): string {
  const now = new Date()
  return chalk.dim(
    `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
  )
}

function formatMessage(level: Exclude<LogLevel, 'silent'>, scope: string, message: string): string {
  const color = LEVEL_COLORS[level]
  const label = LEVEL_LABELS[level]
  const scopeStr = scope ? chalk.cyan(`[${scope}]`) : ''
  return `${formatTime()} ${color(label)} ${scopeStr} ${message}`
}

// ============ 文件日志格式化（无 ANSI 颜色） ============

/** 移除 ANSI 转义序列 */
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*m/g
export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '')
}

/** ISO 8601 时间戳 */
export function formatISOTimestamp(): string {
  return new Date().toISOString()
}

/** 格式化文件日志行（无颜色） */
export function formatFileLogLine(
  level: Exclude<LogLevel, 'silent'>,
  scope: string,
  message: string
): string {
  const timestamp = formatISOTimestamp()
  const label = LEVEL_LABELS[level]
  const scopeStr = scope ? `[${scope}]` : ''
  // 移除消息中的 ANSI 颜色码
  const cleanMessage = stripAnsi(message)
  return `${timestamp} ${label} ${scopeStr} ${cleanMessage}`
}

/** JSON Lines 格式日志条目 */
export interface JsonLogEntry {
  timestamp: string
  level: Exclude<LogLevel, 'silent'>
  scope?: string
  message: string
  data?: Record<string, unknown>
}

/** 格式化为 JSON Lines 格式 */
export function formatJsonLogEntry(
  level: Exclude<LogLevel, 'silent'>,
  scope: string,
  message: string,
  data?: Record<string, unknown>
): string {
  const entry: JsonLogEntry = {
    timestamp: formatISOTimestamp(),
    level,
    message,
  }
  if (scope) entry.scope = scope
  if (data) entry.data = data
  return JSON.stringify(entry)
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export function createLogger(scope: string = ''): Logger {
  return {
    debug(message: string, ...args: unknown[]) {
      if (shouldLog('debug')) {
        console.log(formatMessage('debug', scope, message), ...args)
      }
    },
    info(message: string, ...args: unknown[]) {
      if (shouldLog('info')) {
        console.log(formatMessage('info', scope, message), ...args)
      }
    },
    warn(message: string, ...args: unknown[]) {
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', scope, message), ...args)
      }
    },
    error(message: string, ...args: unknown[]) {
      if (shouldLog('error')) {
        console.error(formatMessage('error', scope, message), ...args)
      }
    },
  }
}

// 默认 logger
export const logger = createLogger()
