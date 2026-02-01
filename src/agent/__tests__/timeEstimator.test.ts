/**
 * 执行时间预估器测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  estimateNodeDuration,
  estimateRemainingTime,
  formatDuration,
  formatTimeEstimate,
  clearCache,
} from '../timeEstimator.js'
import type { TimeEstimate } from '../timeEstimator.js'

describe('timeEstimator', () => {
  beforeEach(() => {
    // 每个测试前清除缓存
    clearCache()
  })

  describe('formatDuration', () => {
    it('should format 0 or negative as "即将完成"', () => {
      expect(formatDuration(0)).toBe('即将完成')
      expect(formatDuration(-100)).toBe('即将完成')
    })

    it('should format less than 1 second', () => {
      expect(formatDuration(500)).toBe('<1s')
      expect(formatDuration(999)).toBe('<1s')
    })

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1s')
      expect(formatDuration(5000)).toBe('5s')
      expect(formatDuration(59000)).toBe('59s')
    })

    it('should format minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m')
      expect(formatDuration(90000)).toBe('1m30s')
      expect(formatDuration(120000)).toBe('2m')
      expect(formatDuration(150000)).toBe('2m30s')
    })

    it('should format hours and minutes', () => {
      expect(formatDuration(3600000)).toBe('1h')
      expect(formatDuration(3660000)).toBe('1h1m')
      expect(formatDuration(5400000)).toBe('1h30m')
      expect(formatDuration(7200000)).toBe('2h')
    })
  })

  describe('estimateNodeDuration', () => {
    it('should return a positive number', () => {
      const duration = estimateNodeDuration('test-node', 'task')
      expect(duration).toBeGreaterThan(0)
    })

    it('should return a reasonable default value when no history', () => {
      const duration = estimateNodeDuration('brand-new-node', 'task')
      // 默认值应该是 2 分钟 (120000ms) 或基于历史数据
      expect(duration).toBeGreaterThan(0)
    })

    it('should handle different node types', () => {
      const taskDuration = estimateNodeDuration('node1', 'task')
      const humanDuration = estimateNodeDuration('node2', 'human')

      // 两者都应该返回正数
      expect(taskDuration).toBeGreaterThan(0)
      expect(humanDuration).toBeGreaterThan(0)
    })
  })

  describe('estimateRemainingTime', () => {
    it('should handle empty nodes array', () => {
      const estimate = estimateRemainingTime([], 0)

      expect(estimate.remainingMs).toBe(0)
      expect(estimate.elapsedMs).toBe(0)
      expect(estimate.remainingFormatted).toBe('即将完成')
    })

    it('should handle all completed nodes', () => {
      const nodes = [
        { name: 'node1', type: 'task', status: 'completed' as const, durationMs: 10000 },
        { name: 'node2', type: 'task', status: 'completed' as const, durationMs: 20000 },
      ]

      const estimate = estimateRemainingTime(nodes, 30000)

      expect(estimate.remainingMs).toBe(0)
      expect(estimate.remainingFormatted).toBe('即将完成')
    })

    it('should estimate remaining time for pending nodes', () => {
      const nodes = [
        { name: 'node1', type: 'task', status: 'completed' as const, durationMs: 10000 },
        { name: 'node2', type: 'task', status: 'pending' as const },
        { name: 'node3', type: 'task', status: 'pending' as const },
      ]

      const estimate = estimateRemainingTime(nodes, 10000)

      expect(estimate.remainingMs).toBeGreaterThan(0)
      expect(estimate.elapsedMs).toBe(10000)
    })

    it('should include running node in estimate', () => {
      const nodes = [
        { name: 'node1', type: 'task', status: 'completed' as const, durationMs: 10000 },
        { name: 'node2', type: 'task', status: 'running' as const },
      ]

      const estimate = estimateRemainingTime(nodes, 15000)

      expect(estimate.remainingMs).toBeGreaterThan(0)
    })

    it('should skip failed and skipped nodes', () => {
      const nodes = [
        { name: 'node1', type: 'task', status: 'completed' as const, durationMs: 10000 },
        { name: 'node2', type: 'task', status: 'failed' as const },
        { name: 'node3', type: 'task', status: 'skipped' as const },
      ]

      const estimate = estimateRemainingTime(nodes, 10000)

      // 失败和跳过的节点不计入剩余时间
      expect(estimate.remainingMs).toBe(0)
    })

    it('should calculate confidence based on samples and progress', () => {
      const nodes = [
        { name: 'node1', type: 'task', status: 'completed' as const, durationMs: 10000 },
        { name: 'node2', type: 'task', status: 'pending' as const },
      ]

      const estimate = estimateRemainingTime(nodes, 10000)

      expect(estimate.confidence).toBeGreaterThan(0)
      expect(estimate.confidence).toBeLessThanOrEqual(1)
    })

    it('should provide formatted remaining time', () => {
      const nodes = [
        { name: 'node1', type: 'task', status: 'pending' as const },
      ]

      const estimate = estimateRemainingTime(nodes, 0)

      expect(typeof estimate.remainingFormatted).toBe('string')
      expect(estimate.remainingFormatted.length).toBeGreaterThan(0)
    })

    it('should handle running node with startedAt', () => {
      const startedAt = new Date(Date.now() - 30000).toISOString() // 30 seconds ago
      const nodes = [
        {
          name: 'node1',
          type: 'task',
          status: 'running' as const,
          startedAt,
        },
      ]

      const estimate = estimateRemainingTime(nodes, 30000)

      // 剩余时间应该考虑已运行的时间
      expect(estimate.remainingMs).toBeGreaterThan(0)
    })
  })

  describe('formatTimeEstimate', () => {
    it('should format high confidence without prefix', () => {
      const estimate: TimeEstimate = {
        remainingMs: 60000,
        totalMs: 120000,
        elapsedMs: 60000,
        confidence: 0.8,
        remainingFormatted: '1m',
      }

      const formatted = formatTimeEstimate(estimate)
      expect(formatted).toBe('1m')
    })

    it('should format medium confidence with ~ prefix', () => {
      const estimate: TimeEstimate = {
        remainingMs: 60000,
        totalMs: 120000,
        elapsedMs: 60000,
        confidence: 0.5,
        remainingFormatted: '1m',
      }

      const formatted = formatTimeEstimate(estimate)
      expect(formatted).toBe('~1m')
    })

    it('should format low confidence with ≈ prefix', () => {
      const estimate: TimeEstimate = {
        remainingMs: 60000,
        totalMs: 120000,
        elapsedMs: 60000,
        confidence: 0.3,
        remainingFormatted: '1m',
      }

      const formatted = formatTimeEstimate(estimate)
      expect(formatted).toBe('≈1m')
    })
  })

  describe('clearCache', () => {
    it('should clear the cache without error', () => {
      // 先触发缓存
      estimateNodeDuration('test', 'task')

      // 清除缓存不应该抛出错误
      expect(() => clearCache()).not.toThrow()
    })

    it('should reset cache timestamp', () => {
      // 触发缓存
      estimateNodeDuration('test1', 'task')

      // 清除缓存
      clearCache()

      // 再次调用应该重新加载数据
      const duration = estimateNodeDuration('test2', 'task')
      expect(duration).toBeGreaterThan(0)
    })
  })

  describe('TimeEstimate interface', () => {
    it('should have all required fields', () => {
      const nodes = [
        { name: 'node1', type: 'task', status: 'pending' as const },
      ]

      const estimate = estimateRemainingTime(nodes, 0)

      expect(typeof estimate.remainingMs).toBe('number')
      expect(typeof estimate.totalMs).toBe('number')
      expect(typeof estimate.elapsedMs).toBe('number')
      expect(typeof estimate.confidence).toBe('number')
      expect(typeof estimate.remainingFormatted).toBe('string')
    })

    it('should calculate totalMs correctly', () => {
      const nodes = [
        { name: 'node1', type: 'task', status: 'completed' as const, durationMs: 10000 },
        { name: 'node2', type: 'task', status: 'pending' as const },
      ]

      const estimate = estimateRemainingTime(nodes, 10000)

      // totalMs = elapsedMs + remainingMs
      expect(estimate.totalMs).toBe(estimate.elapsedMs + estimate.remainingMs)
    })
  })

  describe('edge cases', () => {
    it('should handle very long durations', () => {
      const formatted = formatDuration(86400000) // 24 hours
      expect(formatted).toContain('h')
    })

    it('should handle nodes with no duration info', () => {
      const nodes = [
        { name: 'node1', type: 'task', status: 'completed' as const },
        { name: 'node2', type: 'task', status: 'pending' as const },
      ]

      const estimate = estimateRemainingTime(nodes, 10000)

      expect(estimate.remainingMs).toBeGreaterThan(0)
    })

    it('should handle running node with no startedAt', () => {
      const nodes = [
        { name: 'node1', type: 'task', status: 'running' as const },
      ]

      const estimate = estimateRemainingTime(nodes, 0)

      // 应该假设运行了一半
      expect(estimate.remainingMs).toBeGreaterThan(0)
    })
  })
})
