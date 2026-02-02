/**
 * @entry Shared 公共基础设施模块
 *
 * 提供底层工具函数，无业务逻辑依赖
 *
 * 主要 API:
 * - Result<T,E>: 函数式错误处理
 * - AppError: 统一错误类型
 * - createLogger(): 日志创建
 * - generateId(): ID 生成
 * - formatDuration(): 时间格式化
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
  analyzeError,
  formatError,
} from './error.js'

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
} from './generateId.js'

// 时间处理
export {
  now,
  formatTime,
  formatRelative,
  timeDiff,
  formatDuration,
  parseInterval,
  intervalToCron,
} from './formatTime.js'
