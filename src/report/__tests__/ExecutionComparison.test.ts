/**
 * 执行对比分析测试
 */

import { describe, it, expect } from 'vitest'
import {
  generateRegressionReport,
  formatRegressionReportForTerminal,
  formatRegressionReportForMarkdown,
  collectTaskSnapshots,
} from '../ExecutionComparison.js'
import type { RegressionReport, ComparisonResult, TaskExecutionSnapshot } from '../ExecutionComparison.js'

// 模拟任务快照
const mockTask1: TaskExecutionSnapshot = {
  taskId: 'task-001',
  title: '实现登录功能',
  category: 'feature',
  status: 'completed',
  createdAt: new Date('2026-01-15'),
  durationMs: 120000,
  costUsd: 0.05,
  nodeCount: 4,
  nodeNames: ['analyze', 'implement', 'test', 'commit'],
  successRate: 100,
}

const mockTask2: TaskExecutionSnapshot = {
  taskId: 'task-002',
  title: '实现注册功能',
  category: 'feature',
  status: 'completed',
  createdAt: new Date('2026-01-20'),
  durationMs: 180000, // 50% slower
  costUsd: 0.08, // 60% more expensive
  nodeCount: 5,
  nodeNames: ['analyze', 'implement', 'test', 'review', 'commit'],
  successRate: 100,
}

const mockComparison: ComparisonResult = {
  task1: mockTask1,
  task2: mockTask2,
  durationDiffPercent: 50,
  costDiffPercent: 60,
  nodeCountDiff: 1,
  isRegression: true,
  analysis: [
    '执行时间增加 50% (2m → 3m)',
    '成本增加 60% ($0.05 → $0.08)',
    '新增节点: review',
  ],
}

const mockRegressionReport: RegressionReport = {
  generatedAt: new Date().toISOString(),
  analyzedTasks: 10,
  regressions: [mockComparison],
  improvements: [],
  categoryTrends: [
    {
      category: 'feature',
      avgDurationChange: 25,
      avgCostChange: 15,
      sampleCount: 5,
    },
    {
      category: 'fix',
      avgDurationChange: -10,
      avgCostChange: -5,
      sampleCount: 3,
    },
  ],
  summary: [
    '检测到 1 处性能退化',
    '最严重退化: 实现注册功能 (时间 +50%)',
  ],
}

describe('ExecutionComparison', () => {
  describe('generateRegressionReport', () => {
    it('should generate a regression report', () => {
      const snapshots = collectTaskSnapshots(7)
      const report = generateRegressionReport(snapshots)

      expect(report).toBeDefined()
      expect(report.generatedAt).toBeDefined()
      expect(report.analyzedTasks).toBeGreaterThanOrEqual(0)
      expect(Array.isArray(report.regressions)).toBe(true)
      expect(Array.isArray(report.improvements)).toBe(true)
      expect(Array.isArray(report.categoryTrends)).toBe(true)
      expect(Array.isArray(report.summary)).toBe(true)
    })

    it('should respect days back parameter', () => {
      const snapshots7 = collectTaskSnapshots(7)
      const snapshots30 = collectTaskSnapshots(30)
      const report7 = generateRegressionReport(snapshots7)
      const report30 = generateRegressionReport(snapshots30)

      // 30 天应该分析更多或相同数量的任务
      expect(report30.analyzedTasks).toBeGreaterThanOrEqual(report7.analyzedTasks)
    })

    it('should always have a summary', () => {
      const snapshots = collectTaskSnapshots(1)
      const report = generateRegressionReport(snapshots)
      expect(report.summary.length).toBeGreaterThan(0)
    })
  })

  describe('formatRegressionReportForTerminal', () => {
    it('should format report with header', () => {
      const output = formatRegressionReportForTerminal(mockRegressionReport)

      expect(output).toContain('性能对比分析报告')
      expect(output).toContain('═')
    })

    it('should include task count', () => {
      const output = formatRegressionReportForTerminal(mockRegressionReport)
      expect(output).toContain('10')
    })

    it('should include summary section', () => {
      const output = formatRegressionReportForTerminal(mockRegressionReport)
      expect(output).toContain('总结')
      expect(output).toContain('性能退化')
    })

    it('should include regressions list', () => {
      const output = formatRegressionReportForTerminal(mockRegressionReport)
      expect(output).toContain('实现登录功能')
      expect(output).toContain('实现注册功能')
    })

    it('should show category trends', () => {
      const output = formatRegressionReportForTerminal(mockRegressionReport)
      expect(output).toContain('类型趋势')
      expect(output).toContain('feature')
      expect(output).toContain('fix')
    })

    it('should display percentage changes', () => {
      const output = formatRegressionReportForTerminal(mockRegressionReport)
      expect(output).toContain('+25%')  // feature duration change
      expect(output).toContain('-10%')  // fix duration change
    })
  })

  describe('formatRegressionReportForMarkdown', () => {
    it('should format report as markdown', () => {
      const output = formatRegressionReportForMarkdown(mockRegressionReport)

      expect(output).toContain('# 性能对比分析报告')
      expect(output).toContain('## 总结')
    })

    it('should include markdown tables', () => {
      const output = formatRegressionReportForMarkdown(mockRegressionReport)
      expect(output).toContain('|')
      expect(output).toContain('|------|')
    })

    it('should include regression details', () => {
      const output = formatRegressionReportForMarkdown(mockRegressionReport)
      expect(output).toContain('## 性能退化')
      expect(output).toContain('实现注册功能')
    })

    it('should include category trends table', () => {
      const output = formatRegressionReportForMarkdown(mockRegressionReport)
      expect(output).toContain('## 类型趋势')
      expect(output).toContain('| 类型 |')
    })

    it('should include comparison metrics in table', () => {
      const output = formatRegressionReportForMarkdown(mockRegressionReport)
      expect(output).toContain('执行时间')
      expect(output).toContain('+50%')
    })
  })

  describe('empty report handling', () => {
    it('should handle report with no regressions', () => {
      const emptyReport: RegressionReport = {
        ...mockRegressionReport,
        regressions: [],
        summary: ['各项指标稳定，未检测到明显性能变化'],
      }

      const output = formatRegressionReportForTerminal(emptyReport)
      expect(output).toContain('稳定')
    })

    it('should handle report with no improvements', () => {
      const noImprovementsReport: RegressionReport = {
        ...mockRegressionReport,
        improvements: [],
      }

      const output = formatRegressionReportForTerminal(noImprovementsReport)
      expect(output).toBeDefined()
    })

    it('should handle report with no category trends', () => {
      const noTrendsReport: RegressionReport = {
        ...mockRegressionReport,
        categoryTrends: [],
      }

      const output = formatRegressionReportForTerminal(noTrendsReport)
      expect(output).toBeDefined()
    })
  })

  describe('improvements display', () => {
    it('should display improvements when present', () => {
      const reportWithImprovements: RegressionReport = {
        ...mockRegressionReport,
        improvements: [
          {
            task1: mockTask1,
            task2: {
              ...mockTask2,
              durationMs: 60000, // Faster
              costUsd: 0.03, // Cheaper
            },
            durationDiffPercent: -50,
            costDiffPercent: -40,
            nodeCountDiff: 0,
            isRegression: false,
            analysis: ['执行时间减少 50%', '成本减少 40%'],
          },
        ],
        summary: ['发现 1 处性能改进'],
      }

      const output = formatRegressionReportForTerminal(reportWithImprovements)
      expect(output).toContain('性能改进')
    })
  })

  describe('analysis details', () => {
    it('should include analysis in regression details', () => {
      const output = formatRegressionReportForMarkdown(mockRegressionReport)
      expect(output).toContain('执行时间')
      expect(output).toContain('+50%')
    })

    it('should show analysis items', () => {
      const output = formatRegressionReportForTerminal(mockRegressionReport)
      // 只显示前 2 个 analysis 项，review 是第 3 个
      expect(output).toContain('时间')
    })
  })

  describe('comparison result structure', () => {
    it('should have correct comparison metrics', () => {
      expect(mockComparison.durationDiffPercent).toBe(50)
      expect(mockComparison.costDiffPercent).toBe(60)
      expect(mockComparison.nodeCountDiff).toBe(1)
      expect(mockComparison.isRegression).toBe(true)
    })

    it('should have valid task references', () => {
      expect(mockComparison.task1.taskId).toBe('task-001')
      expect(mockComparison.task2.taskId).toBe('task-002')
    })

    it('should have analysis array', () => {
      expect(Array.isArray(mockComparison.analysis)).toBe(true)
      expect(mockComparison.analysis.length).toBeGreaterThan(0)
    })
  })

  describe('category trends analysis', () => {
    it('should identify slowing categories', () => {
      const slowingCategory = mockRegressionReport.categoryTrends.find(
        t => t.avgDurationChange > 0
      )
      expect(slowingCategory).toBeDefined()
      expect(slowingCategory?.category).toBe('feature')
    })

    it('should identify improving categories', () => {
      const improvingCategory = mockRegressionReport.categoryTrends.find(
        t => t.avgDurationChange < 0
      )
      expect(improvingCategory).toBeDefined()
      expect(improvingCategory?.category).toBe('fix')
    })

    it('should include sample counts', () => {
      for (const trend of mockRegressionReport.categoryTrends) {
        expect(trend.sampleCount).toBeGreaterThan(0)
      }
    })
  })
})
