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

// 错误消息格式化
export { formatErrorMessage } from './formatErrorMessage.js'

// Backend 错误转换
export { toInvokeError } from './toInvokeError.js'

// 文本截断
export { truncateText } from './truncateText.js'

// Claude Code 配置读取
export {
  type SkillEntry,
  type BuildSystemPromptOptions,
  readGlobalClaudeMd,
  readProjectClaudeMd,
  readProjectMemory,
  readAllSkills,
  buildClaudeSystemPrompt,
} from './readClaudeConfig.js'

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
