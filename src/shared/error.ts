/**
 * 统一错误类型
 * 按领域分类，便于定位和处理
 */

export type ErrorCode =
  // 配置错误
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  // 存储错误
  | 'STORE_INIT_FAILED'
  | 'STORE_QUERY_FAILED'
  | 'STORE_NOT_FOUND'
  // Task 错误
  | 'TASK_NOT_FOUND'
  | 'TASK_INVALID_STATE'
  // Git 错误
  | 'GIT_DIRTY_WORKSPACE'
  | 'GIT_BRANCH_EXISTS'
  | 'GIT_MERGE_CONFLICT'
  // Claude 错误
  | 'CLAUDE_INVOKE_FAILED'
  | 'CLAUDE_PARSE_FAILED'
  // 调度错误
  | 'SCHEDULER_ALREADY_RUNNING'
  | 'SCHEDULER_NOT_RUNNING'
  // 通用错误
  | 'UNKNOWN'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }

  // 工厂方法
  static configNotFound(path: string): AppError {
    return new AppError('CONFIG_NOT_FOUND', `Config not found: ${path}`)
  }

  static configInvalid(reason: string): AppError {
    return new AppError('CONFIG_INVALID', `Invalid config: ${reason}`)
  }

  static storeNotFound(entity: string, id: string): AppError {
    return new AppError('STORE_NOT_FOUND', `${entity} not found: ${id}`)
  }

  static taskNotFound(id: string): AppError {
    return new AppError('TASK_NOT_FOUND', `Task not found: ${id}`)
  }

  static gitDirty(): AppError {
    return new AppError('GIT_DIRTY_WORKSPACE', 'Working directory has uncommitted changes')
  }

  static unknown(cause: unknown): AppError {
    const message = cause instanceof Error ? cause.message : String(cause)
    return new AppError('UNKNOWN', message, cause)
  }
}

// 错误断言
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${x}`)
}
