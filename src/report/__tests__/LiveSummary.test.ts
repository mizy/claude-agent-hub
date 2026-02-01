/**
 * 实时任务摘要测试
 */

import { describe, it, expect } from 'vitest'
import {
  generateLiveSummary,
  formatLiveSummaryForTerminal,
  formatLiveSummaryForJson,
} from '../LiveSummary.js'
import type { LiveSummaryReport } from '../LiveSummary.js'

// 模拟报告数据
const mockReport: LiveSummaryReport = {
  generatedAt: new Date().toISOString(),
  runningTasks: [
    {
      taskId: 'task-001',
      title: 'Build the project',
      status: 'running',
      currentNode: 'compile-step',
      progress: {
        completed: 2,
        total: 5,
        percentage: 40,
      },
      startedAt: new Date(Date.now() - 120000),
      elapsedMs: 120000,
    },
  ],
  todaySummary: {
    date: '2026-02-01',
    tasksCreated: 10,
    tasksCompleted: 7,
    tasksFailed: 1,
    tasksRunning: 2,
    totalDurationMs: 600000,
    totalCostUsd: 0.25,
    avgSuccessRate: 87,
  },
  recentCompleted: [
    {
      taskId: 'task-002',
      title: 'Run tests',
      status: 'completed',
      durationMs: 45000,
      completedAt: new Date(Date.now() - 60000).toISOString(),
    },
    {
      taskId: 'task-003',
      title: 'Deploy to staging',
      status: 'failed',
      durationMs: 30000,
      completedAt: new Date(Date.now() - 120000).toISOString(),
    },
  ],
}

describe('LiveSummary', () => {
  describe('generateLiveSummary', () => {
    it('should generate a live summary report', () => {
      const report = generateLiveSummary()

      expect(report).toBeDefined()
      expect(report.generatedAt).toBeDefined()
      expect(report.runningTasks).toBeDefined()
      expect(report.todaySummary).toBeDefined()
      expect(report.recentCompleted).toBeDefined()
    })

    it('should have valid date in today summary', () => {
      const report = generateLiveSummary()
      const today = new Date().toISOString().slice(0, 10)
      expect(report.todaySummary.date).toBe(today)
    })
  })

  describe('formatLiveSummaryForTerminal', () => {
    it('should format running tasks', () => {
      const output = formatLiveSummaryForTerminal(mockReport)

      expect(output).toContain('运行中的任务')
      expect(output).toContain('Build the project')
      expect(output).toContain('40%')
    })

    it('should format today summary', () => {
      const output = formatLiveSummaryForTerminal(mockReport)

      expect(output).toContain('今日统计')
      expect(output).toContain('创建: 10')
      expect(output).toContain('完成: 7')
    })

    it('should format recent completed tasks', () => {
      const output = formatLiveSummaryForTerminal(mockReport)

      expect(output).toContain('最近完成')
      expect(output).toContain('Run tests')
    })

    it('should show colored status icons', () => {
      const output = formatLiveSummaryForTerminal(mockReport)
      // 使用 chalk 会添加 ANSI 颜色代码
      expect(output).toContain('✓')  // 完成
      expect(output).toContain('✗')  // 失败
    })
  })

  describe('formatLiveSummaryForJson', () => {
    it('should return valid JSON string', () => {
      const output = formatLiveSummaryForJson(mockReport)

      expect(() => JSON.parse(output)).not.toThrow()
    })

    it('should contain all report fields', () => {
      const output = formatLiveSummaryForJson(mockReport)
      const parsed = JSON.parse(output)

      expect(parsed.generatedAt).toBeDefined()
      expect(parsed.runningTasks).toBeDefined()
      expect(parsed.todaySummary).toBeDefined()
      expect(parsed.recentCompleted).toBeDefined()
    })
  })

  describe('empty states', () => {
    it('should handle no running tasks', () => {
      const emptyReport: LiveSummaryReport = {
        ...mockReport,
        runningTasks: [],
      }

      const output = formatLiveSummaryForTerminal(emptyReport)
      expect(output).toContain('没有运行中的任务')
    })
  })
})
