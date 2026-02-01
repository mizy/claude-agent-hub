/**
 * executionHistory 单元测试
 */

import { describe, it, expect } from 'vitest'
import { formatInsightsForPrompt } from '../executionHistory.js'
import type { LearningInsights, TaskHistoryEntry } from '../executionHistory.js'

describe('executionHistory', () => {
  describe('formatInsightsForPrompt', () => {
    it('should format empty insights', () => {
      const insights: LearningInsights = {
        successPatterns: [],
        commonFailures: [],
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('## 历史学习')
    })

    it('should format success patterns', () => {
      const insights: LearningInsights = {
        successPatterns: ['历史任务成功率: 80%', '成功任务平均节点数: 5 个'],
        commonFailures: [],
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('### 成功经验')
      expect(prompt).toContain('历史任务成功率: 80%')
      expect(prompt).toContain('成功任务平均节点数: 5 个')
    })

    it('should format common failures', () => {
      const insights: LearningInsights = {
        successPatterns: [],
        commonFailures: ['task 类型节点失败 3 次', 'build 类型节点失败 2 次'],
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('### 需要注意')
      expect(prompt).toContain('task 类型节点失败 3 次')
    })

    it('should format related tasks', () => {
      const relatedTasks: TaskHistoryEntry[] = [
        {
          taskId: 'task-1',
          title: '实现登录功能',
          status: 'completed',
          nodeCount: 5,
          createdAt: '2026-01-30',
        },
        {
          taskId: 'task-2',
          title: '修复登录 bug',
          status: 'failed',
          nodeCount: 3,
          failedNodes: ['fix-bug'],
          createdAt: '2026-01-31',
        },
      ]

      const insights: LearningInsights = {
        successPatterns: [],
        commonFailures: [],
        relatedTasks,
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('### 相关历史任务')
      expect(prompt).toContain('✅ 实现登录功能 (5 节点)')
      expect(prompt).toContain('❌ 修复登录 bug (3 节点)')
    })

    it('should include recommendations', () => {
      const insights: LearningInsights = {
        successPatterns: [],
        commonFailures: [],
        relatedTasks: [],
        recommendedNodeCount: 6,
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('### 建议')
      expect(prompt).toContain('建议将任务拆分为 6 个左右的节点')
    })

    it('should limit related tasks to 5', () => {
      const relatedTasks: TaskHistoryEntry[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          taskId: `task-${i}`,
          title: `任务 ${i}`,
          status: 'completed',
          nodeCount: 5,
          createdAt: '2026-01-30',
        }))

      const insights: LearningInsights = {
        successPatterns: [],
        commonFailures: [],
        relatedTasks,
      }

      const prompt = formatInsightsForPrompt(insights)

      // 应该只显示前 5 个
      const matches = prompt.match(/任务 \d/g) || []
      expect(matches.length).toBe(5)
    })
  })
})
