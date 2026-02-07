/**
 * estimateTime tests
 * Tests time estimation logic with mock historical data
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  estimateNodeDuration,
  estimateRemainingTime,
  formatTimeEstimate,
  clearCache,
  type TimeEstimate,
} from '../estimateTime.js'

beforeEach(() => {
  clearCache()
})

describe('estimateNodeDuration', () => {
  it('should return a positive number', () => {
    const duration = estimateNodeDuration('unknown-node', 'task')
    expect(duration).toBeGreaterThan(0)
  })

  it('should return default (120s) when no historical data', () => {
    const duration = estimateNodeDuration('never-seen-before', 'task')
    // Default is 120000ms = 2 minutes when no history
    expect(duration).toBe(120000)
  })

  it('should return consistent results for same input', () => {
    const d1 = estimateNodeDuration('test-node', 'task')
    const d2 = estimateNodeDuration('test-node', 'task')
    expect(d1).toBe(d2)
  })
})

describe('estimateRemainingTime', () => {
  it('should estimate remaining time for all-pending nodes', () => {
    const nodes = [
      { name: 'build', type: 'task', status: 'pending' as const },
      { name: 'test', type: 'task', status: 'pending' as const },
      { name: 'deploy', type: 'task', status: 'pending' as const },
    ]

    const estimate = estimateRemainingTime(nodes, 0)
    expect(estimate.remainingMs).toBeGreaterThan(0)
    expect(estimate.totalMs).toBeGreaterThan(0)
    expect(estimate.elapsedMs).toBe(0)
    expect(estimate.confidence).toBeGreaterThan(0)
    expect(estimate.confidence).toBeLessThanOrEqual(1)
    expect(estimate.remainingFormatted).toBeTruthy()
  })

  it('should estimate less remaining time when nodes are completed', () => {
    const allPending = [
      { name: 'a', type: 'task', status: 'pending' as const },
      { name: 'b', type: 'task', status: 'pending' as const },
    ]

    const oneCompleted = [
      { name: 'a', type: 'task', status: 'completed' as const, durationMs: 60000 },
      { name: 'b', type: 'task', status: 'pending' as const },
    ]

    const est1 = estimateRemainingTime(allPending, 0)
    const est2 = estimateRemainingTime(oneCompleted, 60000)

    expect(est2.remainingMs).toBeLessThan(est1.remainingMs)
  })

  it('should return zero remaining for all-completed nodes', () => {
    const nodes = [
      { name: 'a', type: 'task', status: 'completed' as const, durationMs: 5000 },
      { name: 'b', type: 'task', status: 'completed' as const, durationMs: 3000 },
    ]

    const estimate = estimateRemainingTime(nodes, 8000)
    expect(estimate.remainingMs).toBe(0)
  })

  it('should not count skipped/failed nodes in remaining', () => {
    const nodes = [
      { name: 'a', type: 'task', status: 'completed' as const, durationMs: 5000 },
      { name: 'b', type: 'task', status: 'skipped' as const },
      { name: 'c', type: 'task', status: 'failed' as const },
    ]

    const estimate = estimateRemainingTime(nodes, 5000)
    expect(estimate.remainingMs).toBe(0)
  })
})

describe('formatTimeEstimate', () => {
  it('should format high-confidence estimate without prefix', () => {
    const estimate: TimeEstimate = {
      remainingMs: 60000,
      totalMs: 120000,
      elapsedMs: 60000,
      confidence: 0.8,
      remainingFormatted: '1m',
    }
    const result = formatTimeEstimate(estimate)
    expect(result).toBe('1m')
  })

  it('should add ~ for medium confidence', () => {
    const estimate: TimeEstimate = {
      remainingMs: 60000,
      totalMs: 120000,
      elapsedMs: 60000,
      confidence: 0.5,
      remainingFormatted: '1m',
    }
    const result = formatTimeEstimate(estimate)
    expect(result).toBe('~1m')
  })

  it('should add ≈ for low confidence', () => {
    const estimate: TimeEstimate = {
      remainingMs: 60000,
      totalMs: 120000,
      elapsedMs: 60000,
      confidence: 0.2,
      remainingFormatted: '1m',
    }
    const result = formatTimeEstimate(estimate)
    expect(result).toBe('≈1m')
  })
})
