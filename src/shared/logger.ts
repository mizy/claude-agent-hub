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

let currentLevel: LogLevel = 'info'

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
