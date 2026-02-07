/**
 * 统一日志系统
 *
 * 功能：
 * - 分级日志（debug/info/warn/error）
 * - 前台/后台模式切换
 * - 日志聚合（合并重复日志）
 * - 结构化上下文信息
 *
 * 使用：
 * - logger.debug/info/warn/error
 * - logger.setMode('foreground'|'background')
 * - setLogLevel('debug'|'info'|'warn'|'error')
 */

import chalk from 'chalk'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'
export type LogMode = 'foreground' | 'background'

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

// ============ 全局状态 ============

// 从环境变量初始化日志级别
function initLogLevel(): LogLevel {
  if (process.env.NODE_ENV === 'test') return 'silent'
  if (process.env.SILENT === '1') return 'silent'
  if (process.env.DEBUG === '1') return 'debug'
  if (process.env.LOG_LEVEL) {
    const level = process.env.LOG_LEVEL as LogLevel
    if (level in LEVEL_PRIORITY) return level
  }
  return 'info'
}

// 从环境变量初始化模式
function initLogMode(): LogMode {
  if (process.env.CAH_BACKGROUND === '1') return 'background'
  // TTY 且非后台环境变量时为前台模式
  return process.stdout.isTTY ? 'foreground' : 'background'
}

let currentLevel: LogLevel = initLogLevel()
let currentMode: LogMode = initLogMode()

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

export function setLogMode(mode: LogMode): void {
  currentMode = mode
}

export function getLogMode(): LogMode {
  return currentMode
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

/**
 * 格式化消息
 * - 前台模式：简洁输出，仅时间+级别+消息
 * - 后台模式：完整结构化输出，包含 scope
 */
function formatMessage(level: Exclude<LogLevel, 'silent'>, scope: string, message: string): string {
  const color = LEVEL_COLORS[level]
  const label = LEVEL_LABELS[level]

  if (currentMode === 'foreground') {
    // 前台模式：简洁友好，方便与进度条配合
    return `${formatTime()} ${color(label)} ${message}`
  }

  // 后台模式：完整结构化，便于诊断
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

// ============ 日志聚合 ============

interface AggregatedLog {
  message: string
  level: Exclude<LogLevel, 'silent'>
  scope: string
  count: number
  firstTime: number
  lastTime: number
  args: unknown[]
}

const LOG_AGGREGATION_WINDOW_MS = 1000 // 1秒内相同日志聚合
const aggregatedLogs = new Map<string, AggregatedLog>()
let aggregationTimer: ReturnType<typeof setTimeout> | null = null

function getAggregationKey(level: string, scope: string, message: string): string {
  return `${level}:${scope}:${message}`
}

function flushAggregatedLogs(): void {
  const now = Date.now()
  const keysToDelete: string[] = []

  aggregatedLogs.forEach((log, key) => {
    // 只输出超过聚合窗口的日志
    if (now - log.lastTime >= LOG_AGGREGATION_WINDOW_MS) {
      outputAggregatedLog(log)
      keysToDelete.push(key)
    }
  })

  keysToDelete.forEach(key => aggregatedLogs.delete(key))

  // 如果还有未输出的日志，继续定时器
  if (aggregatedLogs.size > 0) {
    aggregationTimer = setTimeout(flushAggregatedLogs, LOG_AGGREGATION_WINDOW_MS)
  } else {
    aggregationTimer = null
  }
}

function outputAggregatedLog(log: AggregatedLog): void {
  const { level, scope, message, count, args } = log
  const formattedMessage = count > 1 ? `${message} (×${count})` : message

  const output = formatMessage(level, scope, formattedMessage)
  const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  logFn(output, ...args)
}

/**
 * 立即刷新所有聚合的日志
 * 在程序退出前调用
 */
export function flushLogs(): void {
  if (aggregationTimer) {
    clearTimeout(aggregationTimer)
    aggregationTimer = null
  }

  aggregatedLogs.forEach(log => outputAggregatedLog(log))
  aggregatedLogs.clear()
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  /** 设置此 logger 的输出模式 */
  setMode(mode: LogMode): void
  /** 获取此 logger 的输出模式 */
  getMode(): LogMode
}

export interface LoggerOptions {
  /** 是否启用日志聚合（合并短时间内重复日志） */
  aggregate?: boolean
}

export function createLogger(scope: string = '', options: LoggerOptions = {}): Logger {
  const { aggregate = false } = options

  // 每个 logger 可以有自己的模式，默认跟随全局
  let localMode: LogMode | null = null

  function getEffectiveMode(): LogMode {
    return localMode ?? currentMode
  }

  function logWithLevel(
    level: Exclude<LogLevel, 'silent'>,
    message: string,
    args: unknown[]
  ): void {
    if (!shouldLog(level)) return

    // 如果启用聚合，走聚合逻辑
    if (aggregate && getEffectiveMode() === 'background') {
      const key = getAggregationKey(level, scope, message)
      const now = Date.now()

      const existing = aggregatedLogs.get(key)
      if (existing) {
        existing.count++
        existing.lastTime = now
        existing.args = args // 使用最新的 args
      } else {
        aggregatedLogs.set(key, {
          message,
          level,
          scope,
          count: 1,
          firstTime: now,
          lastTime: now,
          args,
        })
      }

      // 启动定时器（如果还没启动）
      if (!aggregationTimer) {
        aggregationTimer = setTimeout(flushAggregatedLogs, LOG_AGGREGATION_WINDOW_MS)
      }
      return
    }

    // 直接输出
    const output = formatMessage(level, scope, message)
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    logFn(output, ...args)
  }

  return {
    debug(message: string, ...args: unknown[]) {
      logWithLevel('debug', message, args)
    },
    info(message: string, ...args: unknown[]) {
      logWithLevel('info', message, args)
    },
    warn(message: string, ...args: unknown[]) {
      logWithLevel('warn', message, args)
    },
    error(message: string, ...args: unknown[]) {
      logWithLevel('error', message, args)
    },
    setMode(mode: LogMode) {
      localMode = mode
    },
    getMode() {
      return getEffectiveMode()
    },
  }
}

// 默认 logger
export const logger = createLogger()

// ============ 错误日志增强 ============

/** 错误上下文信息，用于增强错误诊断 */
export interface ErrorContext {
  /** 任务 ID */
  taskId?: string
  /** 节点 ID */
  nodeId?: string
  /** 节点名称 */
  nodeName?: string
  /** 执行实例 ID */
  instanceId?: string
  /** 重试次数 */
  attempt?: number
  /** 输入参数（用于复现问题） */
  input?: unknown
  /** 额外数据 */
  [key: string]: unknown
}

/**
 * 记录带上下文的错误日志
 * 自动提取错误信息和堆栈，并附加上下文信息
 *
 * @example
 * logError(logger, 'Node execution failed', err, {
 *   taskId: 'task-123',
 *   nodeId: 'n1',
 *   attempt: 2,
 * })
 */
export function logError(
  loggerInstance: Logger,
  message: string,
  error: Error | string,
  context?: ErrorContext
): void {
  const errorMessage = error instanceof Error ? error.message : error
  const errorStack = error instanceof Error ? error.stack : undefined

  // 构建完整的错误信息
  const fullMessage = `${message}: ${errorMessage}`

  // 构建上下文数据（过滤 undefined 值）
  const data: Record<string, unknown> = {}

  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) {
        data[key] = value
      }
    }
  }

  // 添加堆栈（截取前 5 行避免过长）
  if (errorStack) {
    const stackLines = errorStack.split('\n').slice(0, 6)
    data.stack = stackLines.join('\n')
  }

  // 输出错误日志
  if (Object.keys(data).length > 0) {
    loggerInstance.error(fullMessage, data)
  } else {
    loggerInstance.error(fullMessage)
  }
}

/**
 * 创建带上下文绑定的错误日志函数
 * 适用于需要多次记录错误的场景
 *
 * @example
 * const logNodeError = createErrorLogger(logger, { taskId, nodeId })
 * logNodeError('Parse failed', parseError)
 * logNodeError('Timeout', timeoutError)
 */
export function createErrorLogger(
  loggerInstance: Logger,
  baseContext: ErrorContext
): (message: string, error: Error | string, extraContext?: ErrorContext) => void {
  return (message, error, extraContext) => {
    logError(loggerInstance, message, error, { ...baseContext, ...extraContext })
  }
}
