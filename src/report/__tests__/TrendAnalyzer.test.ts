/**
 * 趋势分析器测试
 */

import { describe, it, expect } from 'vitest'
import { formatTrendReportForTerminal, formatTrendReportForMarkdown } from '../TrendAnalyzer.js'
import type { TrendReport } from '../TrendAnalyzer.js'

// 模拟趋势报告数据
const mockTrendReport: TrendReport = {
  generatedAt: new Date().toISOString(),
  periodStart: new Date('2026-01-01'),
  periodEnd: new Date('2026-01-31'),
  trends: [
    {
      period: {
        label: '2026-01-01',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-08'),
      },
      taskCount: 10,
      successRate: 80,
      avgDurationMs: 120000,
      totalCostUsd: 0.5,
      avgNodesPerTask: 3,
      failureReasons: [
        { reason: 'Timeout', count: 1 },
        { reason: 'API error', count: 1 },
      ],
    },
    {
      period: {
        label: '2026-01-08',
        startDate: new Date('2026-01-08'),
        endDate: new Date('2026-01-15'),
      },
      taskCount: 15,
      successRate: 90,
      avgDurationMs: 100000,
      totalCostUsd: 0.8,
      avgNodesPerTask: 4,
      failureReasons: [],
    },
  ],
  nodePerformance: [
    {
      nodeName: 'build-step',
      nodeType: 'task',
      executionCount: 25,
      avgDurationMs: 30000,
      successRate: 92,
      totalCostUsd: 0.3,
    },
    {
      nodeName: 'test-step',
      nodeType: 'task',
      executionCount: 20,
      avgDurationMs: 45000,
      successRate: 85,
      totalCostUsd: 0.25,
    },
  ],
  costBreakdown: {
    totalCostUsd: 1.3,
    byDate: [
      { date: '2026-01-01', costUsd: 0.1 },
      { date: '2026-01-02', costUsd: 0.2 },
    ],
    byNodeType: [
      { nodeType: 'task', costUsd: 1.0, percentage: 77 },
      { nodeType: 'human', costUsd: 0.3, percentage: 23 },
    ],
    avgCostPerTask: 0.052,
    avgCostPerNode: 0.013,
  },
  insights: ['成功率显著提升: 80% → 90% (+10%)', '执行效率提升: 平均时间减少 16%'],
  categoryStats: [
    {
      category: 'feature',
      taskCount: 15,
      successRate: 87,
      avgDurationMs: 90000,
      totalCostUsd: 0.8,
      avgNodeCount: 4,
    },
    {
      category: 'fix',
      taskCount: 10,
      successRate: 90,
      avgDurationMs: 60000,
      totalCostUsd: 0.5,
      avgNodeCount: 3,
    },
  ],
  nodeHeatmap: [
    {
      combination: '分析代码 → 实现功能',
      count: 8,
      successRate: 88,
      avgDurationMs: 45000,
    },
    {
      combination: '实现功能 → 运行测试',
      count: 6,
      successRate: 83,
      avgDurationMs: 50000,
    },
  ],
  costOptimizations: [
    {
      type: 'high_cost_node',
      suggestion: '以下节点成本高于平均水平: complex-analysis',
      potentialSavingUsd: 0.1,
      affectedItems: ['complex-analysis'],
    },
  ],
}

describe('TrendAnalyzer', () => {
  describe('formatTrendReportForTerminal', () => {
    it('should format report with all sections', () => {
      const output = formatTrendReportForTerminal(mockTrendReport)

      expect(output).toContain('趋势分析报告')
      expect(output).toContain('关键洞察')
      expect(output).toContain('执行趋势')
      expect(output).toContain('节点性能')
      expect(output).toContain('成本分布')
    })

    it('should include insights', () => {
      const output = formatTrendReportForTerminal(mockTrendReport)
      expect(output).toContain('成功率显著提升')
    })

    it('should include trend data', () => {
      const output = formatTrendReportForTerminal(mockTrendReport)
      expect(output).toContain('80%')
      expect(output).toContain('90%')
    })

    it('should include cost data', () => {
      const output = formatTrendReportForTerminal(mockTrendReport)
      expect(output).toContain('总成本')
      expect(output).toContain('1.3')
    })
  })

  describe('formatTrendReportForMarkdown', () => {
    it('should format report as valid markdown', () => {
      const output = formatTrendReportForMarkdown(mockTrendReport)

      expect(output).toContain('# 趋势分析报告')
      expect(output).toContain('## 关键洞察')
      expect(output).toContain('## 执行趋势')
      expect(output).toContain('|')
    })

    it('should include markdown tables', () => {
      const output = formatTrendReportForMarkdown(mockTrendReport)

      // 表头
      expect(output).toContain('| 周期 |')
      expect(output).toContain('|------|')
    })

    it('should include node performance table', () => {
      const output = formatTrendReportForMarkdown(mockTrendReport)
      expect(output).toContain('## 节点性能')
      expect(output).toContain('build-step')
      expect(output).toContain('test-step')
    })
  })

  describe('categoryStats', () => {
    it('should include category statistics in terminal output', () => {
      const output = formatTrendReportForTerminal(mockTrendReport)
      expect(output).toContain('feature')
      expect(output).toContain('fix')
    })

    it('should include category statistics in markdown output', () => {
      const output = formatTrendReportForMarkdown(mockTrendReport)
      expect(output).toContain('feature')
      expect(output).toContain('fix')
    })

    it('should show success rate by category', () => {
      const output = formatTrendReportForTerminal(mockTrendReport)
      expect(output).toContain('87%') // feature success rate
      expect(output).toContain('90%') // fix success rate
    })
  })

  describe('nodeHeatmap', () => {
    it('should include node combination heatmap', () => {
      const output = formatTrendReportForTerminal(mockTrendReport)
      expect(output).toContain('分析代码 → 实现功能')
      expect(output).toContain('实现功能 → 运行测试')
    })

    it('should show combination statistics', () => {
      const output = formatTrendReportForTerminal(mockTrendReport)
      expect(output).toContain('8') // count for first combination
      expect(output).toContain('88%') // success rate for first combination
    })
  })

  describe('costOptimizations', () => {
    it('should include cost optimization suggestions', () => {
      const output = formatTrendReportForTerminal(mockTrendReport)
      expect(output).toContain('complex-analysis')
    })

    it('should show cost optimization section in markdown', () => {
      const output = formatTrendReportForMarkdown(mockTrendReport)
      expect(output).toContain('成本优化建议')
      expect(output).toContain('complex-analysis')
    })
  })

  describe('empty report handling', () => {
    it('should handle report with no category stats', () => {
      const emptyReport: TrendReport = {
        ...mockTrendReport,
        categoryStats: [],
      }
      const output = formatTrendReportForTerminal(emptyReport)
      expect(output).toContain('趋势分析报告')
    })

    it('should handle report with no node heatmap', () => {
      const emptyReport: TrendReport = {
        ...mockTrendReport,
        nodeHeatmap: [],
      }
      const output = formatTrendReportForTerminal(emptyReport)
      expect(output).toContain('趋势分析报告')
    })

    it('should handle report with no cost optimizations', () => {
      const emptyReport: TrendReport = {
        ...mockTrendReport,
        costOptimizations: [],
      }
      const output = formatTrendReportForTerminal(emptyReport)
      expect(output).toContain('趋势分析报告')
    })
  })
})
