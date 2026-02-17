import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordFailure,
  getAllFailures,
  getFailuresByCategory,
  getFailuresByPersona,
  getRecentFailures,
  computeFailureStats,
  formatFailureKnowledgeForPrompt,
  resetStore,
} from '../failureKnowledgeBase.js'

beforeEach(() => {
  resetStore(true)
})

describe('recordFailure', () => {
  it('persists a failure record and returns it', () => {
    const record = recordFailure({
      taskId: 'task-1',
      personaName: 'Pragmatist',
      versionId: 'pv-1',
      category: 'execution',
      confidence: 0.8,
      matchedPatterns: ['timeout', 'exit_code'],
      failedNodes: [{ nodeId: 'n1', nodeName: 'Build', error: 'timeout', attempts: 2 }],
    })

    expect(record.id).toMatch(/^fk-/)
    expect(record.category).toBe('execution')
    expect(record.recordedAt).toBeTruthy()
  })

  it('stores multiple failures', () => {
    recordFailure({
      taskId: 'task-1',
      personaName: 'Pragmatist',
      versionId: 'pv-1',
      category: 'execution',
      confidence: 0.8,
      matchedPatterns: ['timeout'],
      failedNodes: [],
    })
    recordFailure({
      taskId: 'task-2',
      personaName: 'Analyst',
      versionId: 'pv-2',
      category: 'planning',
      confidence: 0.6,
      matchedPatterns: ['json'],
      failedNodes: [],
    })

    expect(getAllFailures()).toHaveLength(2)
  })
})

describe('query functions', () => {
  beforeEach(() => {
    recordFailure({
      taskId: 'task-1',
      personaName: 'Pragmatist',
      versionId: 'pv-1',
      category: 'execution',
      confidence: 0.8,
      matchedPatterns: ['timeout'],
      failedNodes: [],
    })
    recordFailure({
      taskId: 'task-2',
      personaName: 'Analyst',
      versionId: 'pv-2',
      category: 'planning',
      confidence: 0.6,
      matchedPatterns: ['json', 'parse'],
      failedNodes: [],
    })
    recordFailure({
      taskId: 'task-3',
      personaName: 'Pragmatist',
      versionId: 'pv-1',
      category: 'prompt',
      confidence: 0.9,
      matchedPatterns: [],
      failedNodes: [],
      rootCause: 'Missing context',
      suggestion: 'Add project structure analysis',
    })
  })

  it('getFailuresByCategory filters correctly', () => {
    expect(getFailuresByCategory('execution')).toHaveLength(1)
    expect(getFailuresByCategory('planning')).toHaveLength(1)
    expect(getFailuresByCategory('prompt')).toHaveLength(1)
    expect(getFailuresByCategory('resource')).toHaveLength(0)
  })

  it('getFailuresByPersona filters correctly', () => {
    expect(getFailuresByPersona('Pragmatist')).toHaveLength(2)
    expect(getFailuresByPersona('Analyst')).toHaveLength(1)
  })

  it('getRecentFailures returns all recent records', () => {
    expect(getRecentFailures(7)).toHaveLength(3)
  })
})

describe('computeFailureStats', () => {
  beforeEach(() => {
    recordFailure({
      taskId: 'task-1',
      personaName: 'Pragmatist',
      versionId: 'pv-1',
      category: 'execution',
      confidence: 0.8,
      matchedPatterns: ['timeout', 'exit_code'],
      failedNodes: [],
    })
    recordFailure({
      taskId: 'task-2',
      personaName: 'Pragmatist',
      versionId: 'pv-1',
      category: 'execution',
      confidence: 0.8,
      matchedPatterns: ['timeout'],
      failedNodes: [],
    })
    recordFailure({
      taskId: 'task-3',
      personaName: 'Pragmatist',
      versionId: 'pv-1',
      category: 'planning',
      confidence: 0.6,
      matchedPatterns: ['json'],
      failedNodes: [],
    })
  })

  it('computes stats across all personas', () => {
    const stats = computeFailureStats()
    expect(stats.totalFailures).toBe(3)
    expect(stats.byCategory['execution']).toBe(2)
    expect(stats.byCategory['planning']).toBe(1)
    expect(stats.topPatterns[0]?.pattern).toBe('timeout')
    expect(stats.topPatterns[0]?.count).toBe(2)
  })

  it('computes stats for specific persona', () => {
    const stats = computeFailureStats('Pragmatist')
    expect(stats.totalFailures).toBe(3)
  })

  it('returns stable trend when no historical data', () => {
    const stats = computeFailureStats()
    expect(stats.recentTrend).toBe('stable')
  })
})

describe('formatFailureKnowledgeForPrompt', () => {
  it('returns empty string when no failures', () => {
    expect(formatFailureKnowledgeForPrompt()).toBe('')
  })

  it('includes category breakdown and suggestions', () => {
    recordFailure({
      taskId: 'task-1',
      personaName: 'Pragmatist',
      versionId: 'pv-1',
      category: 'execution',
      confidence: 0.8,
      matchedPatterns: ['timeout'],
      failedNodes: [],
      suggestion: 'Add timeout handling',
    })

    const prompt = formatFailureKnowledgeForPrompt()
    expect(prompt).toContain('已知失败模式')
    expect(prompt).toContain('execution')
    expect(prompt).toContain('Add timeout handling')
  })
})
