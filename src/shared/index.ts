/**
 * @entry Shared 公共基础设施模块
 *
 * 底层工具函数，无业务逻辑依赖
 *
 * 能力分组：
 * - Result<T,E>: 函数式错误处理（ok/err/unwrap/map/flatMap/fromPromise/all）
 * - AppError: 统一错误类型（assertNever/printError/printWarning）
 * - Logger: 日志系统（createLogger/setLogLevel/setLogMode/logError/flushLogs）
 * - ID: 生成与匹配（generateId/generateShortId/isValidUUID/shortenId/matchesShortId）
 * - 错误守卫: isError/getErrorMessage/getErrorStack/getErrorCause/ensureError
 * - 错误转换: toInvokeError
 * - 文本: truncateText
 * - 事件总线: taskEventBus（task ↔ messaging 解耦的核心机制）
 * - 时间: now/formatTime/formatRelative/timeDiff/formatDuration/parseInterval/intervalToCron/formatTimeRange
 */

// Result 类型
export {
  type Result,
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  flatMap,
  fromPromise,
  fromThrowable,
  all,
} from './result.js'

// 错误类型
export {
  type ErrorCode,
  type ErrorCategory,
  AppError,
  assertNever,
  printError,
  printWarning,
} from './error.js'

// 日志
export {
  type LogLevel,
  type LogMode,
  type Logger,
  type LoggerOptions,
  type ErrorContext,
  type JsonLogEntry,
  setLogLevel,
  getLogLevel,
  setLogMode,
  getLogMode,
  createLogger,
  logger,
  logError,
  createErrorLogger,
  flushLogs,
  // 文件日志工具
  stripAnsi,
  formatISOTimestamp,
  formatFileLogLine,
  formatJsonLogEntry,
} from './logger.js'

// ID 生成
export {
  generateId,
  generateShortId,
  isValidUUID,
  shortenId,
  matchesShortId,
} from './generateId.js'

// Backend 错误转换
export { toInvokeError } from './toInvokeError.js'

// 错误类型守卫与消息提取
export { isError, getErrorMessage, getErrorStack, getErrorCause, ensureError } from './assertError.js'

// 文本截断
export { truncateText } from './truncateText.js'

// 事件总线
export { taskEventBus, type TaskCompletionPayload, type TaskNodeInfo } from './events/index.js'

// 时间处理
export {
  now,
  formatTime,
  formatRelative,
  timeDiff,
  formatDuration,
  parseInterval,
  intervalToCron,
  formatTimeRange,
  type TimeLocale,
} from './formatTime.js'
