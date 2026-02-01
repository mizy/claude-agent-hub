/**
 * 结构化错误提示系统
 * 提供错误分类、上下文信息和修复建议
 */

import chalk from 'chalk'

// ============ 错误类型定义 ============

export type ErrorCategory =
  | 'validation'      // 输入验证错误
  | 'timeout'         // 超时错误
  | 'network'         // 网络错误
  | 'permission'      // 权限错误
  | 'resource'        // 资源错误（文件不存在等）
  | 'execution'       // 执行错误
  | 'configuration'   // 配置错误
  | 'api'             // API 调用错误
  | 'unknown'         // 未知错误

export interface StructuredError {
  category: ErrorCategory
  code: string
  message: string
  context?: Record<string, unknown>
  suggestions?: string[]
  documentation?: string
}

// ============ 错误模式匹配 ============

interface ErrorPattern {
  pattern: RegExp | ((error: string) => boolean)
  category: ErrorCategory
  code: string
  getSuggestions: (error: string, match?: RegExpMatchArray) => string[]
  getDocumentation?: () => string
}

const errorPatterns: ErrorPattern[] = [
  // 超时错误
  {
    pattern: /timeout|timed out|ETIMEDOUT/i,
    category: 'timeout',
    code: 'ERR_TIMEOUT',
    getSuggestions: () => [
      '增加超时时间: cah "任务" --timeout 600000',
      '将任务拆分为更小的子任务',
      '检查 Claude API 服务状态',
    ],
    getDocumentation: () => 'https://github.com/anthropics/claude-code/issues',
  },

  // 网络错误
  {
    pattern: /ECONNREFUSED|ENOTFOUND|network|connection refused/i,
    category: 'network',
    code: 'ERR_NETWORK',
    getSuggestions: () => [
      '检查网络连接',
      '检查 VPN/代理设置',
      '重试: cah task resume <task-id>',
    ],
  },

  // API 错误 - Rate Limit
  {
    pattern: /rate.?limit|429|too many requests/i,
    category: 'api',
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
    category: 'api',
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
    category: 'api',
    code: 'ERR_QUOTA',
    getSuggestions: () => [
      '检查 Anthropic 账户余额',
      '升级 API 计划',
    ],
  },

  // 资源错误 - 文件不存在
  {
    pattern: /ENOENT|no such file|file not found|not found/i,
    category: 'resource',
    code: 'ERR_FILE_NOT_FOUND',
    getSuggestions: (error) => {
      const pathMatch = error.match(/['"]([^'"]+)['"]/);
      const path = pathMatch?.[1] || '文件路径'
      return [
        `确认文件存在: ls -la ${path}`,
        '检查文件路径是否正确',
        '检查工作目录: pwd',
      ]
    },
  },

  // 资源错误 - 权限
  {
    pattern: /EACCES|permission denied|EPERM/i,
    category: 'permission',
    code: 'ERR_PERMISSION',
    getSuggestions: (error) => {
      const pathMatch = error.match(/['"]([^'"]+)['"]/);
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
    category: 'configuration',
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
    category: 'validation',
    code: 'ERR_VALIDATION',
    getSuggestions: () => [
      '检查输入格式是否正确',
      '查看错误详情确认问题字段',
    ],
  },

  // 执行错误 - 进程相关
  {
    pattern: /spawn|child process|SIGKILL|SIGTERM|killed/i,
    category: 'execution',
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
    category: 'execution',
    code: 'ERR_MEMORY',
    getSuggestions: () => [
      '关闭其他程序释放内存',
      '增加 Node.js 内存限制: NODE_OPTIONS="--max-old-space-size=4096"',
      '将任务拆分为更小的部分',
    ],
  },
]

// ============ 错误分析函数 ============

/**
 * 分析错误并返回结构化信息
 */
export function analyzeError(error: Error | string): StructuredError {
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
      return {
        category: pattern.category,
        code: pattern.code,
        message: errorMessage,
        suggestions: pattern.getSuggestions(errorMessage, match ?? undefined),
        documentation: pattern.getDocumentation?.(),
        context: errorStack ? { stack: errorStack } : undefined,
      }
    }
  }

  // 未匹配到已知模式
  return {
    category: 'unknown',
    code: 'ERR_UNKNOWN',
    message: errorMessage,
    suggestions: [
      '查看完整日志: cah task logs <task-id>',
      '尝试重新执行任务',
      '如问题持续，请报告 issue: https://github.com/anthropics/claude-code/issues',
    ],
    context: errorStack ? { stack: errorStack } : undefined,
  }
}

// ============ 格式化输出 ============

const categoryLabels: Record<ErrorCategory, string> = {
  validation: '输入验证',
  timeout: '超时',
  network: '网络',
  permission: '权限',
  resource: '资源',
  execution: '执行',
  configuration: '配置',
  api: 'API',
  unknown: '未知',
}

const categoryColors: Record<ErrorCategory, (text: string) => string> = {
  validation: chalk.yellow,
  timeout: chalk.magenta,
  network: chalk.red,
  permission: chalk.red,
  resource: chalk.yellow,
  execution: chalk.red,
  configuration: chalk.yellow,
  api: chalk.red,
  unknown: chalk.gray,
}

/**
 * 格式化错误输出到终端
 */
export function formatError(error: StructuredError): string {
  const lines: string[] = []
  const colorFn = categoryColors[error.category]

  // 错误头部
  lines.push('')
  lines.push(chalk.red('✗') + ' ' + chalk.bold('错误') + ` [${colorFn(categoryLabels[error.category])}]`)
  lines.push('')

  // 错误码和消息
  lines.push(chalk.dim(`  代码: ${error.code}`))
  lines.push(`  ${error.message}`)

  // 修复建议
  if (error.suggestions && error.suggestions.length > 0) {
    lines.push('')
    lines.push(chalk.cyan('  建议修复:'))
    for (const suggestion of error.suggestions) {
      lines.push(chalk.dim('    →') + ` ${suggestion}`)
    }
  }

  // 文档链接
  if (error.documentation) {
    lines.push('')
    lines.push(chalk.dim('  文档: ') + chalk.underline(error.documentation))
  }

  lines.push('')

  return lines.join('\n')
}

/**
 * 打印错误到终端
 */
export function printError(error: Error | string): void {
  const structured = analyzeError(error)
  console.error(formatError(structured))
}

/**
 * 简单错误输出（用于非关键错误）
 */
export function printWarning(message: string, suggestions?: string[]): void {
  console.warn('')
  console.warn(chalk.yellow('!') + ' ' + chalk.bold('警告'))
  console.warn(`  ${message}`)
  if (suggestions && suggestions.length > 0) {
    console.warn('')
    console.warn(chalk.cyan('  建议:'))
    for (const s of suggestions) {
      console.warn(chalk.dim('    →') + ` ${s}`)
    }
  }
  console.warn('')
}

// ============ 常用错误快捷方法 ============

export function taskNotFoundError(taskId: string): StructuredError {
  return {
    category: 'resource',
    code: 'ERR_TASK_NOT_FOUND',
    message: `任务不存在: ${taskId}`,
    suggestions: [
      '查看所有任务: cah task list',
      '使用正确的任务 ID 或短 ID',
      '任务可能已被删除',
    ],
  }
}

export function workflowGenerationError(reason: string): StructuredError {
  return {
    category: 'execution',
    code: 'ERR_WORKFLOW_GEN',
    message: `Workflow 生成失败: ${reason}`,
    suggestions: [
      '简化任务描述，使用更清晰的指令',
      '检查 Claude API 状态',
      '重试: cah task resume <task-id>',
    ],
  }
}

export function nodeExecutionError(nodeName: string, reason: string): StructuredError {
  return {
    category: 'execution',
    code: 'ERR_NODE_EXEC',
    message: `节点执行失败 [${nodeName}]: ${reason}`,
    suggestions: [
      `检查节点详情: cah task stats <task-id>`,
      '查看完整日志找出错误原因',
      '从失败节点恢复: cah task resume <task-id>',
    ],
  }
}
