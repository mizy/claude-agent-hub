/**
 * Shared 模块统一导出
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
export { type ErrorCode, AppError, assertNever } from './error.js'

// 日志
export {
  type LogLevel,
  type Logger,
  setLogLevel,
  getLogLevel,
  createLogger,
  logger,
} from './logger.js'

// ID 生成
export {
  generateId,
  generateShortId,
  isValidUUID,
  shortenId,
  matchesShortId,
} from './id.js'

// 时间处理
export {
  now,
  formatTime,
  formatRelative,
  timeDiff,
  formatDuration,
  parseInterval,
  intervalToCron,
} from './time.js'
