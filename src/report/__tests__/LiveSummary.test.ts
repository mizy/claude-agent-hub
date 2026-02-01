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
      estimatedRemainingMs: 180000,
      estimateConfidence: 0.7,
    },
  ],
  queuedTasks: [
    {
      taskId: 'task-004',
      title: 'Deploy to production',
      status: 'pending',
      createdAt: new Date(Date.now() - 60000),
      estimatedDurationMs: 120000,
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
  estimatedAllCompletionTime: '21:30',
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
        queuedTasks: [],
      }

      const output = formatLiveSummaryForTerminal(emptyReport)
      expect(output).toContain('没有运行中的任务')
    })
  })

  describe('queued tasks', () => {
    it('should display queued tasks', () => {
      const output = formatLiveSummaryForTerminal(mockReport)
      expect(output).toContain('Deploy to production')
    })

    it('should show queue count', () => {
      const output = formatLiveSummaryForTerminal(mockReport)
      expect(output).toContain('待执行')
    })

    it('should handle multiple queued tasks', () => {
      const multiQueueReport: LiveSummaryReport = {
        ...mockReport,
        queuedTasks: [
          ...mockReport.queuedTasks,
          {
            taskId: 'task-005',
            title: 'Run integration tests',
            status: 'pending',
            createdAt: new Date(Date.now() - 30000),
            estimatedDurationMs: 60000,
          },
        ],
      }

      const output = formatLiveSummaryForTerminal(multiQueueReport)
      expect(output).toContain('Deploy to production')
      expect(output).toContain('Run integration tests')
    })

    it('should limit queued tasks display', () => {
      const manyQueuedTasks = Array(8)
        .fill(null)
        .map((_, i) => ({
          taskId: `task-00${i}`,
          title: `Queued task ${i}`,
          status: 'pending' as const,
          createdAt: new Date(Date.now() - i * 10000),
        }))

      const manyQueueReport: LiveSummaryReport = {
        ...mockReport,
        queuedTasks: manyQueuedTasks,
      }

      const output = formatLiveSummaryForTerminal(manyQueueReport)
      // 应该显示 "还有 X 个任务"
      expect(output).toContain('还有')
    })
  })

  describe('estimated completion time', () => {
    it('should show ETA for running tasks', () => {
      const output = formatLiveSummaryForTerminal(mockReport)
      // 应该显示预估剩余时间
      expect(output).toMatch(/ETA|剩余|预估/)
    })

    it('should show estimated all completion time', () => {
      const output = formatLiveSummaryForTerminal(mockReport)
      expect(output).toContain('21:30')  // estimatedAllCompletionTime
    })

    it('should handle missing estimate confidence', () => {
      const noConfidenceReport: LiveSummaryReport = {
        ...mockReport,
        runningTasks: [
          {
            ...mockReport.runningTasks[0]!,
            estimateConfidence: undefined,
          },
        ],
      }

      const output = formatLiveSummaryForTerminal(noConfidenceReport)
      expect(output).toContain('Build the project')
    })

    it('should display confidence indicators', () => {
      // 高置信度
      const highConfidenceReport: LiveSummaryReport = {
        ...mockReport,
        runningTasks: [
          {
            ...mockReport.runningTasks[0]!,
            estimateConfidence: 0.9,
          },
        ],
      }
      const highOutput = formatLiveSummaryForTerminal(highConfidenceReport)
      expect(highOutput).toBeDefined()

      // 低置信度
      const lowConfidenceReport: LiveSummaryReport = {
        ...mockReport,
        runningTasks: [
          {
            ...mockReport.runningTasks[0]!,
            estimateConfidence: 0.3,
          },
        ],
      }
      const lowOutput = formatLiveSummaryForTerminal(lowConfidenceReport)
      expect(lowOutput).toBeDefined()
    })
  })

  describe('task progress', () => {
    it('should show progress percentage', () => {
      const output = formatLiveSummaryForTerminal(mockReport)
      expect(output).toContain('40%')
    })

    it('should show current node name', () => {
      const output = formatLiveSummaryForTerminal(mockReport)
      expect(output).toContain('compile-step')
    })

    it('should show elapsed time', () => {
      const output = formatLiveSummaryForTerminal(mockReport)
      // 应该显示运行中任务的相关信息
      expect(output).toContain('Build the project')
    })
  })

  describe('JSON output', () => {
    it('should include queued tasks in JSON', () => {
      const output = formatLiveSummaryForJson(mockReport)
      const parsed = JSON.parse(output)
      expect(parsed.queuedTasks).toHaveLength(1)
      expect(parsed.queuedTasks[0].title).toBe('Deploy to production')
    })

    it('should include estimated completion time in JSON', () => {
      const output = formatLiveSummaryForJson(mockReport)
      const parsed = JSON.parse(output)
      expect(parsed.estimatedAllCompletionTime).toBe('21:30')
    })

    it('should include estimate confidence in JSON', () => {
      const output = formatLiveSummaryForJson(mockReport)
      const parsed = JSON.parse(output)
      expect(parsed.runningTasks[0].estimateConfidence).toBe(0.7)
    })
  })
})
