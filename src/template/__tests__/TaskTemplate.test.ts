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
})
