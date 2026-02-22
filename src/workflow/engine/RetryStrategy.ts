/**
 * 智能重试策略
 * 支持指数退避、jitter 和错误分类
 */

import { createLogger } from '../../shared/logger.js'
import { formatErrorMessage } from '../../shared/formatErrorMessage.js'

const logger = createLogger('retry-strategy')

// ============ 错误分类 ============

export type ErrorCategory =
  | 'transient' // 暂时性错误，应该重试 (网络超时、API 限流等)
  | 'recoverable' // 可恢复错误，可以重试但成功率低 (服务暂时不可用)
  | 'permanent' // 永久性错误，不应重试 (认证失败、资源不存在)
  | 'unknown' // 未知错误，使用默认策略

export interface ClassifiedError {
  category: ErrorCategory
  message: string
  originalError: unknown
  retryable: boolean
  suggestedDelayMs?: number
}

/**
 * 错误分类器
 * 根据错误消息和类型判断错误类别
 */
export function classifyError(error: unknown): ClassifiedError {
  const message = formatErrorMessage(error)
  const lowerMessage = message.toLowerCase()

  // 暂时性错误 - 高重试成功率
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('econnreset') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('socket hang up') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('429') ||
    lowerMessage.includes('503') ||
    lowerMessage.includes('502') ||
    lowerMessage.includes('overloaded') ||
    lowerMessage.includes('temporarily unavailable') ||
    lowerMessage.includes('connection reset') ||
    lowerMessage.includes('epipe') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('etimedout')
  ) {
    let suggestedDelayMs: number | undefined
    if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
      suggestedDelayMs = 30000 // rate limit 需要更长等待
    } else if (lowerMessage.includes('overloaded')) {
      suggestedDelayMs = 15000 // API 过载等 15 秒
    }
    return {
      category: 'transient',
      message,
      originalError: error,
      retryable: true,
      suggestedDelayMs,
    }
  }

  // 可恢复错误 - 可以重试但成功率较低
  if (
    lowerMessage.includes('500') ||
    lowerMessage.includes('internal server error') ||
    lowerMessage.includes('service unavailable') ||
    lowerMessage.includes('temporarily') ||
    lowerMessage.includes('busy') ||
    lowerMessage.includes('capacity') ||
    lowerMessage.includes('please try again') ||
    lowerMessage.includes('retry later') ||
    lowerMessage.includes('too many requests')
  ) {
    return {
      category: 'recoverable',
      message,
      originalError: error,
      retryable: true,
    }
  }

  // 进程被外部终止 - 不应重试（SIGTERM/SIGKILL 来自 daemon 停止、任务取消等）
  if (
    lowerMessage.includes('sigterm') ||
    lowerMessage.includes('sigkill') ||
    lowerMessage.includes('killed') ||
    lowerMessage.includes('cannot be launched inside another') ||
    lowerMessage.includes('nested sessions')
  ) {
    return {
      category: 'permanent',
      message,
      originalError: error,
      retryable: false,
    }
  }

  // 永久性错误 - 不应重试
  if (
    lowerMessage.includes('401') ||
    lowerMessage.includes('403') ||
    lowerMessage.includes('404') ||
    lowerMessage.includes('authentication') ||
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('forbidden') ||
    lowerMessage.includes('not found') ||
    lowerMessage.includes('invalid') ||
    lowerMessage.includes('malformed') ||
    lowerMessage.includes('syntax error') ||
    lowerMessage.includes('permission denied')
  ) {
    return {
      category: 'permanent',
      message,
      originalError: error,
      retryable: false,
    }
  }

  // 未知错误 - 默认允许重试
  return {
    category: 'unknown',
    message,
    originalError: error,
    retryable: true,
  }
}

// ============ 重试配置 ============

export interface RetryConfig {
  maxAttempts: number // 最大重试次数
  baseDelayMs: number // 基础延迟（毫秒）
  maxDelayMs: number // 最大延迟（毫秒）
  backoffMultiplier: number // 退避乘数
  jitterFactor: number // 抖动因子 (0-1)
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000, // 1 秒起始
  maxDelayMs: 60000, // 最多等待 1 分钟
  backoffMultiplier: 2, // 指数退避
  jitterFactor: 0.2, // 20% 随机抖动
}

// 针对不同错误类别的配置调整
export const RETRY_CONFIG_BY_CATEGORY: Record<ErrorCategory, Partial<RetryConfig>> = {
  transient: {
    maxAttempts: 5, // 暂时性错误多重试几次
    baseDelayMs: 2000,
  },
  recoverable: {
    maxAttempts: 3,
    baseDelayMs: 5000, // 等久一点
    backoffMultiplier: 3,
  },
  permanent: {
    maxAttempts: 1, // 不重试
  },
  unknown: {
    maxAttempts: 3,
    baseDelayMs: 2000,
  },
}

// ============ 重试延迟计算 ============

export interface RetryDecision {
  shouldRetry: boolean
  delayMs: number
  reason: string
  attempt: number
  nextAttempt: number
}

/**
 * 计算重试延迟（带指数退避和 jitter）
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // 指数退避: baseDelay * (multiplier ^ attempt)
  const exponentialDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1)

  // 限制最大延迟
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs)

  // 添加 jitter 防止惊群效应
  // jitter 范围: [-jitterFactor, +jitterFactor]
  const jitter = (Math.random() * 2 - 1) * config.jitterFactor * cappedDelay

  const finalDelay = Math.max(0, Math.round(cappedDelay + jitter))

  return finalDelay
}

/**
 * 决定是否应该重试
 */
export function shouldRetry(
  error: unknown,
  attempt: number,
  nodeConfig?: { maxAttempts?: number; backoffMs?: number; backoffMultiplier?: number }
): RetryDecision {
  const classified = classifyError(error)

  // 获取针对该错误类别的配置
  const categoryConfig = RETRY_CONFIG_BY_CATEGORY[classified.category]
  const config: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...categoryConfig,
  }

  // 如果节点有自定义配置，优先使用
  if (nodeConfig?.maxAttempts !== undefined) {
    config.maxAttempts = nodeConfig.maxAttempts
  }
  if (nodeConfig?.backoffMs !== undefined) {
    config.baseDelayMs = nodeConfig.backoffMs
  }
  if (nodeConfig?.backoffMultiplier !== undefined) {
    config.backoffMultiplier = nodeConfig.backoffMultiplier
  }

  // 判断是否应该重试
  const canRetry = classified.retryable && attempt < config.maxAttempts

  if (!canRetry) {
    const reason = !classified.retryable
      ? `Error is not retryable (${classified.category}): ${classified.message.slice(0, 100)}`
      : `Max attempts reached (${attempt}/${config.maxAttempts})`

    return {
      shouldRetry: false,
      delayMs: 0,
      reason,
      attempt,
      nextAttempt: attempt,
    }
  }

  // 计算延迟
  let delayMs = calculateRetryDelay(attempt, config)

  // 如果错误本身建议了延迟时间，使用更长的那个
  if (classified.suggestedDelayMs) {
    delayMs = Math.max(delayMs, classified.suggestedDelayMs)
  }

  return {
    shouldRetry: true,
    delayMs,
    reason: `Retrying ${classified.category} error (attempt ${attempt + 1}/${config.maxAttempts})`,
    attempt,
    nextAttempt: attempt + 1,
  }
}

// ============ 重试执行器 ============

export interface RetryableOperation<T> {
  (): Promise<T>
}

export interface RetryResult<T> {
  success: boolean
  result?: T
  error?: ClassifiedError
  attempts: number
  totalDelayMs: number
}

/**
 * 带重试的执行函数
 */
export async function withRetry<T>(
  operation: RetryableOperation<T>,
  config: Partial<RetryConfig> = {},
  onRetry?: (decision: RetryDecision) => void
): Promise<RetryResult<T>> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config }
  let attempt = 1
  let totalDelayMs = 0

  while (true) {
    try {
      const result = await operation()
      return {
        success: true,
        result,
        attempts: attempt,
        totalDelayMs,
      }
    } catch (error) {
      const decision = shouldRetry(error, attempt, fullConfig)

      logger.debug(
        `Attempt ${attempt} failed: ${decision.reason}`,
        decision.shouldRetry ? `Retrying in ${decision.delayMs}ms` : 'Not retrying'
      )

      if (!decision.shouldRetry) {
        return {
          success: false,
          error: classifyError(error),
          attempts: attempt,
          totalDelayMs,
        }
      }

      // 通知调用者重试决定
      onRetry?.(decision)

      // 等待后重试
      await sleep(decision.delayMs)
      totalDelayMs += decision.delayMs
      attempt++
    }
  }
}

// ============ 辅助函数 ============

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 格式化重试信息用于日志
 */
export function formatRetryInfo(decision: RetryDecision): string {
  if (!decision.shouldRetry) {
    return `Will not retry: ${decision.reason}`
  }
  return `Will retry in ${decision.delayMs}ms (attempt ${decision.nextAttempt}): ${decision.reason}`
}
