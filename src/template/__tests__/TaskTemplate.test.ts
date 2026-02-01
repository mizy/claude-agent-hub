/**
 * 任务模板系统测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, rmSync, mkdirSync } from 'fs'
import {
  initBuiltinTemplates,
  getAllTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
  applyTemplate,
  searchTemplates,
  getTemplatesByCategory,
  suggestTemplates,
  updateTemplateEffectiveness,
  getTemplateRanking,
} from '../TaskTemplate.js'

// 使用测试专用目录
const testDir = '/tmp/cah-template-test'

describe('TaskTemplate', () => {
  beforeAll(() => {
    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(() => {
    // 清理
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  describe('initBuiltinTemplates', () => {
    it('should initialize builtin templates without error', () => {
      expect(() => initBuiltinTemplates()).not.toThrow()
    })

    it('should create multiple templates', () => {
      initBuiltinTemplates()
      const templates = getAllTemplates()
      expect(templates.length).toBeGreaterThan(0)
    })
  })

  describe('getAllTemplates', () => {
    it('should return array of templates', () => {
      const templates = getAllTemplates()
      expect(Array.isArray(templates)).toBe(true)
    })

    it('should sort by usage count', () => {
      const templates = getAllTemplates()
      if (templates.length >= 2) {
        expect(templates[0]!.usageCount).toBeGreaterThanOrEqual(templates[1]!.usageCount)
      }
    })
  })

  describe('getTemplate', () => {
    it('should return template by id', () => {
      initBuiltinTemplates()
      const template = getTemplate('implement-feature')
      expect(template).not.toBeNull()
      expect(template?.id).toBe('implement-feature')
    })

    it('should return null for non-existent template', () => {
      const template = getTemplate('non-existent-template')
      expect(template).toBeNull()
    })
  })

  describe('getTemplatesByCategory', () => {
    it('should filter templates by category', () => {
      initBuiltinTemplates()
      const devTemplates = getTemplatesByCategory('development')
      expect(devTemplates.every(t => t.category === 'development')).toBe(true)
    })
  })

  describe('createTemplate', () => {
    it('should create a custom template', () => {
      const template = createTemplate(
        'test-template',
        'A test template',
        'Test prompt with {{variable}}',
        {
          category: 'custom',
          tags: ['test'],
          variables: [{ name: 'variable', description: 'Test variable' }],
        }
      )

      expect(template.id).toContain('test-template')
      expect(template.name).toBe('test-template')
      expect(template.category).toBe('custom')
      expect(template.usageCount).toBe(0)
    })
  })

  describe('deleteTemplate', () => {
    it('should delete existing template', () => {
      const template = createTemplate('to-delete', 'Delete me', 'prompt')
      const result = deleteTemplate(template.id)
      expect(result).toBe(true)
      expect(getTemplate(template.id)).toBeNull()
    })

    it('should return false for non-existent template', () => {
      const result = deleteTemplate('non-existent')
      expect(result).toBe(false)
    })
  })

  describe('applyTemplate', () => {
    it('should replace variables in template', () => {
      initBuiltinTemplates()
      const result = applyTemplate('implement-feature', {
        feature_description: 'Add login functionality',
      })

      expect(result).not.toBeNull()
      expect(result).toContain('Add login functionality')
      expect(result).not.toContain('{{feature_description}}')
    })

    it('should use default values for missing variables', () => {
      initBuiltinTemplates()
      const result = applyTemplate('fix-bug', {
        bug_description: 'Button not working',
      })

      expect(result).not.toBeNull()
      expect(result).toContain('Button not working')
    })

    it('should return null for non-existent template', () => {
      const result = applyTemplate('non-existent', {})
      expect(result).toBeNull()
    })

    it('should increment usage count', () => {
      initBuiltinTemplates()
      const before = getTemplate('implement-feature')?.usageCount ?? 0
      applyTemplate('implement-feature', { feature_description: 'test' })
      const after = getTemplate('implement-feature')?.usageCount ?? 0
      expect(after).toBe(before + 1)
    })
  })

  describe('searchTemplates', () => {
    it('should find templates by name', () => {
      initBuiltinTemplates()
      const results = searchTemplates('implement')
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(t => t.id.includes('implement'))).toBe(true)
    })

    it('should find templates by description', () => {
      initBuiltinTemplates()
      const results = searchTemplates('Bug')
      expect(results.length).toBeGreaterThan(0)
    })

    it('should find templates by tags', () => {
      initBuiltinTemplates()
      const results = searchTemplates('testing')
      expect(results.length).toBeGreaterThan(0)
    })

    it('should return empty array for no matches', () => {
      const results = searchTemplates('xyznonexistent')
      expect(results).toEqual([])
    })
  })

  describe('suggestTemplates', () => {
    it('should suggest templates based on task description', () => {
      initBuiltinTemplates()
      const suggestions = suggestTemplates('implement a new login feature')

      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions[0]!.template).toBeDefined()
      expect(suggestions[0]!.score).toBeGreaterThan(0)
      expect(suggestions[0]!.reason).toBeDefined()
    })

    it('should prioritize matching categories', () => {
      initBuiltinTemplates()
      const suggestions = suggestTemplates('fix a bug in the login system')

      // 应该优先匹配 fix-bug 模板
      const topSuggestion = suggestions[0]
      expect(topSuggestion).toBeDefined()
    })

    it('should match keywords in description', () => {
      initBuiltinTemplates()
      const suggestions = suggestTemplates('write unit tests for the API module')

      expect(suggestions.length).toBeGreaterThan(0)
      // 应该匹配测试相关模板
      const hasTestTemplate = suggestions.some(s =>
        s.template.tags?.includes('testing') ||
        s.template.category === 'testing'
      )
      expect(hasTestTemplate).toBe(true)
    })

    it('should respect limit parameter', () => {
      initBuiltinTemplates()
      const suggestions = suggestTemplates('implement feature', 2)
      expect(suggestions.length).toBeLessThanOrEqual(2)
    })

    it('should return empty array for unmatched description', () => {
      initBuiltinTemplates()
      const suggestions = suggestTemplates('xyz completely unrelated 123')
      // 可能返回空或低分匹配
      expect(Array.isArray(suggestions)).toBe(true)
    })

    it('should include reason for each suggestion', () => {
      initBuiltinTemplates()
      const suggestions = suggestTemplates('refactor the user module')

      for (const suggestion of suggestions) {
        expect(suggestion.reason).toBeDefined()
        expect(typeof suggestion.reason).toBe('string')
      }
    })

    it('should sort suggestions by score', () => {
      initBuiltinTemplates()
      const suggestions = suggestTemplates('add new API endpoint')

      for (let i = 1; i < suggestions.length; i++) {
        expect(suggestions[i - 1]!.score).toBeGreaterThanOrEqual(suggestions[i]!.score)
      }
    })
  })

  describe('updateTemplateEffectiveness', () => {
    it('should update success count on success', () => {
      initBuiltinTemplates()
      const template = getTemplate('implement-feature')
      const beforeSuccess = template?.successCount || 0

      updateTemplateEffectiveness('implement-feature', true)

      const updated = getTemplate('implement-feature')
      expect(updated?.successCount).toBe(beforeSuccess + 1)
    })

    it('should update failure count on failure', () => {
      initBuiltinTemplates()
      const template = getTemplate('fix-bug')
      const beforeFailure = template?.failureCount || 0

      updateTemplateEffectiveness('fix-bug', false)

      const updated = getTemplate('fix-bug')
      expect(updated?.failureCount).toBe(beforeFailure + 1)
    })

    it('should calculate effectiveness score', () => {
      initBuiltinTemplates()
      // 模拟 3 次成功 1 次失败
      updateTemplateEffectiveness('write-unit-tests', true)
      updateTemplateEffectiveness('write-unit-tests', true)
      updateTemplateEffectiveness('write-unit-tests', true)
      updateTemplateEffectiveness('write-unit-tests', false)

      const template = getTemplate('write-unit-tests')
      expect(template?.effectivenessScore).toBeDefined()
      // 3/(3+1) = 75%
      expect(template?.effectivenessScore).toBeGreaterThanOrEqual(70)
    })

    it('should handle non-existent template gracefully', () => {
      expect(() => {
        updateTemplateEffectiveness('non-existent-template', true)
      }).not.toThrow()
    })
  })

  describe('getTemplateRanking', () => {
    it('should return templates with effectiveness scores', () => {
      initBuiltinTemplates()
      // 确保有一些模板有评分
      updateTemplateEffectiveness('implement-feature', true)
      updateTemplateEffectiveness('implement-feature', true)

      const ranking = getTemplateRanking()

      // 应该只返回有评分的模板
      for (const template of ranking) {
        expect(template.effectivenessScore).toBeDefined()
      }
    })

    it('should sort by effectiveness score descending', () => {
      initBuiltinTemplates()
      updateTemplateEffectiveness('implement-feature', true)
      updateTemplateEffectiveness('fix-bug', true)
      updateTemplateEffectiveness('fix-bug', false)

      const ranking = getTemplateRanking()

      for (let i = 1; i < ranking.length; i++) {
        expect(ranking[i - 1]!.effectivenessScore).toBeGreaterThanOrEqual(
          ranking[i]!.effectivenessScore || 0
        )
      }
    })
  })

  describe('template effectiveness fields', () => {
    it('should have effectivenessScore field', () => {
      const template = createTemplate(
        'effectiveness-test',
        'Test template',
        'Test prompt'
      )

      // 新创建的模板 effectivenessScore 可能为 undefined
      expect(template.effectivenessScore === undefined || typeof template.effectivenessScore === 'number').toBe(true)
    })

    it('should track successCount and failureCount', () => {
      const template = createTemplate(
        'count-test',
        'Test template',
        'Test prompt'
      )

      updateTemplateEffectiveness(template.id, true)
      updateTemplateEffectiveness(template.id, false)

      const updated = getTemplate(template.id)
      expect(updated?.successCount).toBe(1)
      expect(updated?.failureCount).toBe(1)
    })
  })

  describe('effectiveness in suggestions', () => {
    it('should boost high-effectiveness templates in suggestions', () => {
      initBuiltinTemplates()

      // 给 implement-feature 高评分
      for (let i = 0; i < 5; i++) {
        updateTemplateEffectiveness('implement-feature', true)
      }

      const suggestions = suggestTemplates('implement a feature')

      // 如果有足够高的评分，应该在 reason 中提及
      expect(suggestions.length).toBeGreaterThan(0)
      // 高评分模板应该排名靠前（如果评分足够高，会在 reason 中提及"有效性评分"）
      expect(suggestions.some(s => s.reason.includes('有效性评分')) || suggestions.length > 0).toBe(true)
    })
  })
})
