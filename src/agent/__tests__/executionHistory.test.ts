/**
 * executionHistory 单元测试
 */

import { describe, it, expect } from 'vitest'
import { formatInsightsForPrompt } from '../executionHistory.js'
import type { LearningInsights, TaskHistoryEntry, TaskCategory, NodePattern } from '../executionHistory.js'

describe('executionHistory', () => {
  describe('formatInsightsForPrompt', () => {
    it('should format empty insights', () => {
      const insights: LearningInsights = {
        taskCategory: 'other',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('## 历史学习')
      expect(prompt).toContain('任务类型识别为: **other**')
    })

    it('should format success patterns', () => {
      const insights: LearningInsights = {
        taskCategory: 'feature',
        successPatterns: ['历史任务成功率: 80%', '成功任务平均节点数: 5 个'],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('### 成功经验')
      expect(prompt).toContain('历史任务成功率: 80%')
      expect(prompt).toContain('成功任务平均节点数: 5 个')
    })

    it('should format common failures', () => {
      const insights: LearningInsights = {
        taskCategory: 'fix',
        successPatterns: [],
        commonFailures: ['task 类型节点失败 3 次', 'build 类型节点失败 2 次'],
        successfulNodePatterns: [],
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('### 需要规避的失败模式')
      expect(prompt).toContain('task 类型节点失败 3 次')
    })

    it('should format related tasks', () => {
      const relatedTasks: TaskHistoryEntry[] = [
        {
          taskId: 'task-1',
          title: '实现登录功能',
          category: 'feature',
          status: 'completed',
          nodeCount: 5,
          createdAt: '2026-01-30',
        },
        {
          taskId: 'task-2',
          title: '修复登录 bug',
          category: 'fix',
          status: 'failed',
          nodeCount: 3,
          failedNodes: ['fix-bug'],
          createdAt: '2026-01-31',
        },
      ]

      const insights: LearningInsights = {
        taskCategory: 'feature',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks,
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('### 相关历史任务')
      expect(prompt).toContain('✅ 实现登录功能 (5 节点)')
      expect(prompt).toContain('❌ 修复登录 bug [fix] (3 节点)')
    })

    it('should include recommendations', () => {
      const insights: LearningInsights = {
        taskCategory: 'refactor',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks: [],
        recommendedNodeCount: 6,
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('### 节点设计建议')
      expect(prompt).toContain('**refactor** 类型任务推荐 6 个左右的节点')
    })

    it('should format successful node patterns', () => {
      const insights: LearningInsights = {
        taskCategory: 'git',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [
          {
            name: 'git-pattern-1',
            nodeSequence: ['analyze-changes', 'commit-and-verify'],
            occurrences: 5,
            successRate: 1.0,
          },
        ],
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('### 成功的节点模式')
      expect(prompt).toContain('analyze-changes → commit-and-verify')
      expect(prompt).toContain('成功率: 100%')
    })

    it('should limit related tasks to 5', () => {
      const relatedTasks: TaskHistoryEntry[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          taskId: `task-${i}`,
          title: `任务 ${i}`,
          category: 'other' as const,
          status: 'completed',
          nodeCount: 5,
          createdAt: '2026-01-30',
        }))

      const insights: LearningInsights = {
        taskCategory: 'other',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks,
      }

      const prompt = formatInsightsForPrompt(insights)

      // 应该只显示前 5 个
      const matches = prompt.match(/任务 \d/g) || []
      expect(matches.length).toBe(5)
    })

    it('should include node names in task display', () => {
      const relatedTasks: TaskHistoryEntry[] = [
        {
          taskId: 'task-1',
          title: '添加登录功能',
          category: 'feature',
          status: 'completed',
          nodeCount: 3,
          nodeNames: ['analyze', 'implement', 'test'],
          createdAt: '2026-01-30',
        },
      ]

      const insights: LearningInsights = {
        taskCategory: 'feature',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks,
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('添加登录功能')
      expect(prompt).toContain('3 节点')
    })

    it('should handle failure reasons in related tasks', () => {
      const relatedTasks: TaskHistoryEntry[] = [
        {
          taskId: 'task-1',
          title: '修复编译错误',
          category: 'fix',
          status: 'failed',
          nodeCount: 2,
          failedNodes: ['compile-step'],
          failureReasons: ['TypeScript 编译错误: 类型不匹配'],
          createdAt: '2026-01-30',
        },
      ]

      const insights: LearningInsights = {
        taskCategory: 'fix',
        successPatterns: [],
        commonFailures: ['历史失败: compile-step: TypeScript 编译错误'],
        successfulNodePatterns: [],
        relatedTasks,
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('❌ 修复编译错误')
      expect(prompt).toContain('需要规避的失败模式')
    })

    it('should format different task categories correctly', () => {
      const categories: TaskCategory[] = ['git', 'refactor', 'feature', 'fix', 'docs', 'test', 'iteration', 'other']

      for (const category of categories) {
        const insights: LearningInsights = {
          taskCategory: category,
          successPatterns: [],
          commonFailures: [],
          successfulNodePatterns: [],
          relatedTasks: [],
        }

        const prompt = formatInsightsForPrompt(insights)
        expect(prompt).toContain(`任务类型识别为: **${category}**`)
      }
    })

    it('should include category-specific advice for git tasks', () => {
      const insights: LearningInsights = {
        taskCategory: 'git',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('Git 操作')
      expect(prompt).toContain('2-3 个节点')
    })

    it('should include category-specific advice for refactor tasks', () => {
      const insights: LearningInsights = {
        taskCategory: 'refactor',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('typecheck')
    })

    it('should include category-specific advice for feature tasks', () => {
      const insights: LearningInsights = {
        taskCategory: 'feature',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('分析')
      expect(prompt).toContain('实现')
    })

    it('should include category-specific advice for fix tasks', () => {
      const insights: LearningInsights = {
        taskCategory: 'fix',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('定位')
      expect(prompt).toContain('验证')
    })

    it('should handle tasks with duration info', () => {
      const relatedTasks: TaskHistoryEntry[] = [
        {
          taskId: 'task-1',
          title: '快速任务',
          category: 'git',
          status: 'completed',
          nodeCount: 2,
          durationSec: 120,
          createdAt: '2026-01-30',
        },
      ]

      const insights: LearningInsights = {
        taskCategory: 'git',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks,
      }

      const prompt = formatInsightsForPrompt(insights)
      expect(prompt).toContain('快速任务')
    })

    it('should show category tag for different category tasks', () => {
      const relatedTasks: TaskHistoryEntry[] = [
        {
          taskId: 'task-1',
          title: '相关任务',
          category: 'test',  // 不同于 insights 的 category
          status: 'completed',
          nodeCount: 3,
          createdAt: '2026-01-30',
        },
      ]

      const insights: LearningInsights = {
        taskCategory: 'feature',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: [],
        relatedTasks,
      }

      const prompt = formatInsightsForPrompt(insights)

      // 不同类型的任务应该显示类型标签
      expect(prompt).toContain('[test]')
    })

    it('should handle multiple node patterns', () => {
      const patterns: NodePattern[] = [
        {
          name: 'pattern-1',
          nodeSequence: ['analyze', 'implement', 'test'],
          occurrences: 5,
          successRate: 0.9,
        },
        {
          name: 'pattern-2',
          nodeSequence: ['prepare', 'execute'],
          occurrences: 3,
          successRate: 0.8,
        },
      ]

      const insights: LearningInsights = {
        taskCategory: 'feature',
        successPatterns: [],
        commonFailures: [],
        successfulNodePatterns: patterns,
        relatedTasks: [],
      }

      const prompt = formatInsightsForPrompt(insights)

      expect(prompt).toContain('成功的节点模式')
      expect(prompt).toContain('analyze → implement → test')
      expect(prompt).toContain('90%')
      expect(prompt).toContain('prepare → execute')
      expect(prompt).toContain('80%')
    })
  })
})
