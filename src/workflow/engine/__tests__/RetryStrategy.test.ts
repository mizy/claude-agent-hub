/**
 * RetryStrategy 测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  classifyError,
  shouldRetry,
  calculateRetryDelay,
  withRetry,
  formatRetryInfo,
  DEFAULT_RETRY_CONFIG,
  RETRY_CONFIG_BY_CATEGORY,
} from '../RetryStrategy.js'

describe('RetryStrategy', () => {
  describe('classifyError', () => {
    it('should classify timeout errors as transient', () => {
      const result = classifyError(new Error('Request timeout'))
      expect(result.category).toBe('transient')
      expect(result.retryable).toBe(true)
    })

    it('should classify network errors as transient', () => {
      const result = classifyError(new Error('ECONNRESET'))
      expect(result.category).toBe('transient')
      expect(result.retryable).toBe(true)
    })

    it('should classify rate limit errors as transient with suggested delay', () => {
      const result = classifyError(new Error('Rate limit exceeded (429)'))
      expect(result.category).toBe('transient')
      expect(result.retryable).toBe(true)
      expect(result.suggestedDelayMs).toBe(30000)
    })

    it('should classify 503 errors as transient', () => {
      const result = classifyError(new Error('503 Service Unavailable'))
      expect(result.category).toBe('transient')
      expect(result.retryable).toBe(true)
    })

    it('should classify 500 errors as recoverable', () => {
      const result = classifyError(new Error('500 Internal Server Error'))
      expect(result.category).toBe('recoverable')
      expect(result.retryable).toBe(true)
    })

    it('should classify authentication errors as permanent', () => {
      const result = classifyError(new Error('401 Unauthorized'))
      expect(result.category).toBe('permanent')
      expect(result.retryable).toBe(false)
    })

    it('should classify 404 errors as permanent', () => {
      const result = classifyError(new Error('404 Not Found'))
      expect(result.category).toBe('permanent')
      expect(result.retryable).toBe(false)
    })

    it('should classify permission denied as permanent', () => {
      const result = classifyError(new Error('Permission denied'))
      expect(result.category).toBe('permanent')
      expect(result.retryable).toBe(false)
    })

    it('should classify unknown errors as unknown and retryable', () => {
      const result = classifyError(new Error('Something weird happened'))
      expect(result.category).toBe('unknown')
      expect(result.retryable).toBe(true)
    })

    it('should handle string errors', () => {
      const result = classifyError('ECONNREFUSED')
      expect(result.category).toBe('transient')
      expect(result.message).toBe('ECONNREFUSED')
    })
  })

  describe('calculateRetryDelay', () => {
    it('should return base delay for first attempt', () => {
      const delay = calculateRetryDelay(1, {
        ...DEFAULT_RETRY_CONFIG,
        jitterFactor: 0, // Disable jitter for predictable testing
      })
      expect(delay).toBe(DEFAULT_RETRY_CONFIG.baseDelayMs)
    })

    it('should apply exponential backoff', () => {
      const config = {
        ...DEFAULT_RETRY_CONFIG,
        jitterFactor: 0,
        baseDelayMs: 1000,
        backoffMultiplier: 2,
      }

      expect(calculateRetryDelay(1, config)).toBe(1000)  // 1000 * 2^0
      expect(calculateRetryDelay(2, config)).toBe(2000)  // 1000 * 2^1
      expect(calculateRetryDelay(3, config)).toBe(4000)  // 1000 * 2^2
      expect(calculateRetryDelay(4, config)).toBe(8000)  // 1000 * 2^3
    })

    it('should cap delay at maxDelayMs', () => {
      const config = {
        ...DEFAULT_RETRY_CONFIG,
        jitterFactor: 0,
        baseDelayMs: 1000,
        backoffMultiplier: 10,
        maxDelayMs: 5000,
      }

      // 1000 * 10^2 = 100000, but capped at 5000
      expect(calculateRetryDelay(3, config)).toBe(5000)
    })

    it('should add jitter within bounds', () => {
      const config = {
        ...DEFAULT_RETRY_CONFIG,
        baseDelayMs: 1000,
        jitterFactor: 0.2,
        backoffMultiplier: 1,
      }

      // Run multiple times to verify jitter is applied
      const delays = new Set<number>()
      for (let i = 0; i < 100; i++) {
        delays.add(calculateRetryDelay(1, config))
      }

      // Should have some variation
      expect(delays.size).toBeGreaterThan(1)

      // All delays should be within expected range (800-1200 for 20% jitter)
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(800)
        expect(delay).toBeLessThanOrEqual(1200)
      }
    })
  })

  describe('shouldRetry', () => {
    it('should allow retry for transient errors', () => {
      const decision = shouldRetry(new Error('timeout'), 1)
      expect(decision.shouldRetry).toBe(true)
      expect(decision.nextAttempt).toBe(2)
    })

    it('should not retry permanent errors', () => {
      const decision = shouldRetry(new Error('401 Unauthorized'), 1)
      expect(decision.shouldRetry).toBe(false)
      expect(decision.reason).toContain('not retryable')
    })

    it('should stop retrying after max attempts', () => {
      // Transient errors have maxAttempts: 5, so attempt 5 should not retry
      const decision = shouldRetry(new Error('timeout'), 5)
      expect(decision.shouldRetry).toBe(false)
      expect(decision.reason).toContain('Max attempts reached')
    })

    it('should respect node-specific retry config', () => {
      const nodeConfig = { maxAttempts: 5 }
      const decision = shouldRetry(new Error('timeout'), 3, nodeConfig)
      expect(decision.shouldRetry).toBe(true)
    })

    it('should use category-specific config for transient errors', () => {
      const decision = shouldRetry(new Error('timeout'), 4)
      // Transient errors have maxAttempts: 5
      expect(decision.shouldRetry).toBe(true)
    })

    it('should use suggested delay from error classification', () => {
      const decision = shouldRetry(new Error('rate limit'), 1)
      expect(decision.shouldRetry).toBe(true)
      expect(decision.delayMs).toBeGreaterThanOrEqual(30000)
    })
  })

  describe('withRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return result on success', async () => {
      const operation = vi.fn().mockResolvedValue('success')
      const resultPromise = withRetry(operation)

      // Fast-forward timers
      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result.success).toBe(true)
      expect(result.result).toBe('success')
      expect(result.attempts).toBe(1)
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should retry on transient failure', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success')

      const resultPromise = withRetry(operation, {
        baseDelayMs: 100,
        jitterFactor: 0,
      })

      // Fast-forward through delays
      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result.success).toBe(true)
      expect(result.result).toBe('success')
      expect(result.attempts).toBe(2)
      expect(operation).toHaveBeenCalledTimes(2)
    })

    it('should not retry permanent errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('401 Unauthorized'))

      const resultPromise = withRetry(operation)

      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result.success).toBe(false)
      expect(result.error?.category).toBe('permanent')
      expect(result.attempts).toBe(1)
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should give up after max attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('timeout'))

      const resultPromise = withRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 100,
        jitterFactor: 0,
      })

      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result.success).toBe(false)
      expect(result.attempts).toBe(3)
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it('should call onRetry callback', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success')

      const onRetry = vi.fn()

      const resultPromise = withRetry(
        operation,
        { baseDelayMs: 100, jitterFactor: 0 },
        onRetry
      )

      await vi.runAllTimersAsync()

      await resultPromise
      expect(onRetry).toHaveBeenCalledTimes(1)
      expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
        shouldRetry: true,
        attempt: 1,
        nextAttempt: 2,
      }))
    })

    it('should track total delay time', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('some random error'))
        .mockRejectedValueOnce(new Error('some random error'))
        .mockResolvedValue('success')

      const resultPromise = withRetry(operation, {
        baseDelayMs: 1000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        maxAttempts: 5,
      })

      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result.success).toBe(true)
      expect(result.attempts).toBe(3)
      // Total delay should be positive (accounting for category-specific config)
      expect(result.totalDelayMs).toBeGreaterThan(0)
    })
  })

  describe('formatRetryInfo', () => {
    it('should format retry decision', () => {
      const decision = {
        shouldRetry: true,
        delayMs: 5000,
        reason: 'Retrying transient error',
        attempt: 2,
        nextAttempt: 3,
      }

      const info = formatRetryInfo(decision)
      expect(info).toContain('5000ms')
      expect(info).toContain('attempt 3')
    })

    it('should format non-retry decision', () => {
      const decision = {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Max attempts reached',
        attempt: 3,
        nextAttempt: 3,
      }

      const info = formatRetryInfo(decision)
      expect(info).toContain('Will not retry')
      expect(info).toContain('Max attempts reached')
    })
  })

  describe('RETRY_CONFIG_BY_CATEGORY', () => {
    it('should have correct config for transient errors', () => {
      const config = RETRY_CONFIG_BY_CATEGORY.transient
      expect(config.maxAttempts).toBe(5)
      expect(config.baseDelayMs).toBe(2000)
    })

    it('should have correct config for permanent errors', () => {
      const config = RETRY_CONFIG_BY_CATEGORY.permanent
      expect(config.maxAttempts).toBe(1)
    })

    it('should have correct config for recoverable errors', () => {
      const config = RETRY_CONFIG_BY_CATEGORY.recoverable
      expect(config.maxAttempts).toBe(3)
      expect(config.baseDelayMs).toBe(5000)
      expect(config.backoffMultiplier).toBe(3)
    })
  })
})
