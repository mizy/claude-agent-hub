/**
 * 统一错误处理系统
 * 支持错误分类、上下文信息和修复建议
 */

import chalk from 'chalk'
import { getErrorMessage } from './assertError.js'

// ============ 错误分类定义 ============

export type ErrorCategory =
  | 'CONFIG' // 配置错误
  | 'TASK' // 任务错误
  | 'WORKFLOW' // 工作流错误
  | 'NETWORK' // 网络错误
  | 'PERMISSION' // 权限错误
  | 'RUNTIME' // 运行时错误
  | 'API' // API 调用错误
  | 'RESOURCE' // 资源错误（文件不存在等）
  | 'VALIDATION' // 输入验证错误
  | 'TIMEOUT' // 超时错误
  | 'UNKNOWN' // 未知错误

// 为向后兼容保留的 ErrorCode 类型
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
  // 来自 cli/errors.ts 的错误码
  | 'ERR_TIMEOUT'
  | 'ERR_NETWORK'
  | 'ERR_RATE_LIMIT'
  | 'ERR_AUTH'
  | 'ERR_QUOTA'
  | 'ERR_FILE_NOT_FOUND'
  | 'ERR_PERMISSION'
  | 'ERR_CONFIG'
  | 'ERR_VALIDATION'
  | 'ERR_PROCESS'
  | 'ERR_MEMORY'
  | 'ERR_TASK_NOT_FOUND'
  | 'ERR_WORKFLOW_GEN'
  | 'ERR_NODE_EXEC'
  | 'ERR_UNKNOWN'

// ============ 统一错误类 ============

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly category: ErrorCategory = 'UNKNOWN',
    public readonly cause?: unknown,
    public readonly suggestion?: string
  ) {
    super(message)
    this.name = 'AppError'
  }

  /**
   * 格式化错误输出到终端
   */
  format(): string {
    const lines: string[] = []
    const colorFn = categoryColors[this.category]

    lines.push('')
    lines.push(
      chalk.red('✗') + ' ' + chalk.bold('错误') + ` [${colorFn(categoryLabels[this.category])}]`
    )
    lines.push('')
    lines.push(chalk.dim(`  代码: ${this.code}`))
    lines.push(`  ${this.message}`)

    if (this.suggestion) {
      lines.push('')
      lines.push(chalk.cyan('  建议修复:'))
      lines.push(chalk.dim('    →') + ` ${this.suggestion}`)
    }

    lines.push('')
    return lines.join('\n')
  }

  // ============ 工厂方法 ============

  static configNotFound(path: string): AppError {
    return new AppError(
      'CONFIG_NOT_FOUND',
      `Config not found: ${path}`,
      'CONFIG',
      undefined,
      '检查配置文件路径是否正确'
    )
  }

  static configInvalid(reason: string): AppError {
    return new AppError(
      'CONFIG_INVALID',
      `Invalid config: ${reason}`,
      'CONFIG',
      undefined,
      '参考文档确认配置格式'
    )
  }

  static storeNotFound(entity: string, id: string): AppError {
    return new AppError(
      'STORE_NOT_FOUND',
      `${entity} not found: ${id}`,
      'RESOURCE',
      undefined,
      '确认资源 ID 是否正确'
    )
  }

  static taskNotFound(id: string): AppError {
    return new AppError(
      'TASK_NOT_FOUND',
      `任务不存在: ${id}`,
      'TASK',
      undefined,
      '查看所有任务: cah task list'
    )
  }

  static gitDirty(): AppError {
    return new AppError(
      'GIT_DIRTY_WORKSPACE',
      'Working directory has uncommitted changes',
      'WORKFLOW',
      undefined,
      '提交或暂存更改后重试'
    )
  }

  static workflowGeneration(reason: string): AppError {
    return new AppError(
      'ERR_WORKFLOW_GEN',
      `Workflow 生成失败: ${reason}`,
      'WORKFLOW',
      undefined,
      '简化任务描述，使用更清晰的指令'
    )
  }

  static nodeExecution(nodeName: string, reason: string): AppError {
    return new AppError(
      'ERR_NODE_EXEC',
      `节点执行失败 [${nodeName}]: ${reason}`,
      'RUNTIME',
      undefined,
      '从失败节点恢复: cah task resume <task-id>'
    )
  }

  static timeout(message?: string): AppError {
    return new AppError(
      'ERR_TIMEOUT',
      message || '操作超时',
      'TIMEOUT',
      undefined,
      '增加超时时间或将任务拆分为更小的子任务'
    )
  }

  static network(message?: string): AppError {
    return new AppError(
      'ERR_NETWORK',
      message || '网络连接失败',
      'NETWORK',
      undefined,
      '检查网络连接和 VPN/代理设置'
    )
  }

  static permission(path?: string): AppError {
    return new AppError(
      'ERR_PERMISSION',
      path ? `权限不足: ${path}` : '权限不足',
      'PERMISSION',
      undefined,
      '检查文件权限或使用 sudo'
    )
  }

  static apiError(code: 'ERR_RATE_LIMIT' | 'ERR_AUTH' | 'ERR_QUOTA', message: string): AppError {
    const suggestions: Record<string, string> = {
      ERR_RATE_LIMIT: '等待几分钟后重试',
      ERR_AUTH: '检查 ANTHROPIC_API_KEY 环境变量或重新运行 claude login',
      ERR_QUOTA: '检查 Anthropic 账户余额',
    }
    return new AppError(code, message, 'API', undefined, suggestions[code])
  }

  static unknown(cause: unknown): AppError {
    const message = getErrorMessage(cause)
    return new AppError('UNKNOWN', message, 'UNKNOWN', cause)
  }

  /**
   * 从普通 Error 或字符串创建 AppError（使用错误模式匹配）
   */
  static fromError(error: Error | string): AppError {
    const errorMessage = typeof error === 'string' ? error : error.message
    const errorStack = typeof error === 'string' ? undefined : error.stack

    // 尝试匹配已知错误模式
    for (const pattern of errorPatterns) {
      let match: RegExpMatchArray | null = null
      let isMatch = false

      if (typeof pattern.pattern === 'function') {
        isMatch = pattern.pattern(errorMessage)
      } else {
        match = errorMessage.match(pattern.pattern)
        isMatch = match !== null
      }

      if (isMatch) {
        const suggestion = pattern.getSuggestions(errorMessage, match ?? undefined)[0]
        return new AppError(
          pattern.code,
          errorMessage,
          pattern.category,
          errorStack ? { stack: errorStack } : undefined,
          suggestion
        )
      }
    }

    // 未匹配到已知模式
    return new AppError(
      'ERR_UNKNOWN',
      errorMessage,
      'UNKNOWN',
      errorStack ? { stack: errorStack } : undefined,
      '查看完整日志: cah task logs <task-id>'
    )
  }
}

// ============ 错误模式匹配 ============

interface ErrorPattern {
  pattern: RegExp | ((error: string) => boolean)
  category: ErrorCategory
  code: ErrorCode
  getSuggestions: (error: string, match?: RegExpMatchArray) => string[]
}

const errorPatterns: ErrorPattern[] = [
  // 超时错误
  {
    pattern: /timeout|timed out|ETIMEDOUT/i,
    category: 'TIMEOUT',
    code: 'ERR_TIMEOUT',
    getSuggestions: () => [
      '增加超时时间: cah "任务" --timeout 600000',
      '将任务拆分为更小的子任务',
      '检查 Claude API 服务状态',
    ],
  },

  // 网络错误
  {
    pattern: /ECONNREFUSED|ENOTFOUND|network|connection refused/i,
    category: 'NETWORK',
    code: 'ERR_NETWORK',
    getSuggestions: () => ['检查网络连接', '检查 VPN/代理设置', '重试: cah task resume <task-id>'],
  },

  // API 错误 - Rate Limit
  {
    pattern: /rate.?limit|429|too many requests/i,
    category: 'API',
    code: 'ERR_RATE_LIMIT',
    getSuggestions: () => [
      '等待几分钟后重试',
      '检查 API 使用配额',
      '使用 cah task resume <task-id> 恢复任务',
    ],
  },

  // API 错误 - 认证
  {
    pattern: /unauthorized|401|api.?key|authentication/i,
    category: 'API',
    code: 'ERR_AUTH',
    getSuggestions: () => [
      '检查 ANTHROPIC_API_KEY 环境变量',
      '验证 API 密钥是否有效',
      '重新运行 claude login',
    ],
  },

  // API 错误 - 配额
  {
    pattern: /quota|credit|billing|payment|402/i,
    category: 'API',
    code: 'ERR_QUOTA',
    getSuggestions: () => ['检查 Anthropic 账户余额', '升级 API 计划'],
  },

  // 资源错误 - 文件不存在
  {
    pattern: /ENOENT|no such file|file not found|not found/i,
    category: 'RESOURCE',
    code: 'ERR_FILE_NOT_FOUND',
    getSuggestions: error => {
      const pathMatch = error.match(/['"]([^'"]+)['"]/)
      const path = pathMatch?.[1] || '文件路径'
      return [`确认文件存在: ls -la ${path}`, '检查文件路径是否正确', '检查工作目录: pwd']
    },
  },

  // 资源错误 - 权限
  {
    pattern: /EACCES|permission denied|EPERM/i,
    category: 'PERMISSION',
    code: 'ERR_PERMISSION',
    getSuggestions: error => {
      const pathMatch = error.match(/['"]([^'"]+)['"]/)
      const path = pathMatch?.[1] || '路径'
      return [
        `检查文件权限: ls -la ${path}`,
        `修改权限: chmod 644 ${path}`,
        '确认当前用户有足够权限',
      ]
    },
  },

  // 配置错误
  {
    pattern: /invalid.?config|configuration|missing.?field|required/i,
    category: 'CONFIG',
    code: 'ERR_CONFIG',
    getSuggestions: () => [
      '检查任务配置文件: cat task.json',
      '参考文档确认必填字段',
      '使用默认配置重试',
    ],
  },

  // 验证错误
  {
    pattern: /invalid|validation|malformed|parse error|syntax error/i,
    category: 'VALIDATION',
    code: 'ERR_VALIDATION',
    getSuggestions: () => ['检查输入格式是否正确', '查看错误详情确认问题字段'],
  },

  // 执行错误 - 进程相关
  {
    pattern: /spawn|child process|SIGKILL|SIGTERM|killed/i,
    category: 'RUNTIME',
    code: 'ERR_PROCESS',
    getSuggestions: () => [
      '检查系统资源使用: top',
      '释放内存后重试',
      '使用 cah task resume <task-id> 恢复',
    ],
  },

  // 执行错误 - 内存
  {
    pattern: /out of memory|heap|ENOMEM/i,
    category: 'RUNTIME',
    code: 'ERR_MEMORY',
    getSuggestions: () => [
      '关闭其他程序释放内存',
      '增加 Node.js 内存限制: NODE_OPTIONS="--max-old-space-size=4096"',
      '将任务拆分为更小的部分',
    ],
  },
]

// ============ 格式化输出 ============

const categoryLabels: Record<ErrorCategory, string> = {
  CONFIG: '配置',
  TASK: '任务',
  WORKFLOW: '工作流',
  NETWORK: '网络',
  PERMISSION: '权限',
  RUNTIME: '运行时',
  API: 'API',
  RESOURCE: '资源',
  VALIDATION: '验证',
  TIMEOUT: '超时',
  UNKNOWN: '未知',
}

const categoryColors: Record<ErrorCategory, (text: string) => string> = {
  CONFIG: chalk.yellow,
  TASK: chalk.red,
  WORKFLOW: chalk.magenta,
  NETWORK: chalk.red,
  PERMISSION: chalk.red,
  RUNTIME: chalk.red,
  API: chalk.red,
  RESOURCE: chalk.yellow,
  VALIDATION: chalk.yellow,
  TIMEOUT: chalk.magenta,
  UNKNOWN: chalk.gray,
}

/**
 * 打印错误到终端
 */
export function printError(error: Error | string | AppError): void {
  if (error instanceof AppError) {
    console.error(error.format())
  } else {
    const appError = AppError.fromError(error)
    console.error(appError.format())
  }
}

/**
 * 打印警告到终端
 */
export function printWarning(message: string, suggestion?: string): void {
  console.warn('')
  console.warn(chalk.yellow('!') + ' ' + chalk.bold('警告'))
  console.warn(`  ${message}`)
  if (suggestion) {
    console.warn('')
    console.warn(chalk.cyan('  建议:'))
    console.warn(chalk.dim('    →') + ` ${suggestion}`)
  }
  console.warn('')
}

// ============ 错误断言 ============

export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${x}`)
}
