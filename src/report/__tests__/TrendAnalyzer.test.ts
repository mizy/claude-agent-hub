/**
 * 趋势分析器测试
 */

import { describe, it, expect } from 'vitest'
import {
  formatTrendReportForTerminal,
  formatTrendReportForMarkdown,
} from '../TrendAnalyzer.js'
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
  insights: [
    '成功率显著提升: 80% → 90% (+10%)',
    '执行效率提升: 平均时间减少 16%',
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
})
