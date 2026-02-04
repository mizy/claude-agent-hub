/**
 * 空字符串处理测试
 *
 * 测试系统各模块对空字符串、空白字符串的处理
 * 优先级：P0 (Critical) > P1 (High) > P2 (Medium)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { rm, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTaskWithFolder } from '../src/task/createTaskWithFolder.js'
import { createTemplate, getTemplate, applyTemplate } from '../src/template/TemplateCore.js'
import { isGenericTitle } from '../src/output/generateTaskTitle.js'

// 测试数据：各种空字符串变体
const EMPTY_VARIANTS = [
  { value: '', name: 'empty string' },
  { value: '   ', name: 'spaces only' },
  { value: '\t', name: 'tab' },
  { value: '\n', name: 'newline' },
  { value: ' \t\n ', name: 'mixed whitespace' },
]

// 测试临时目录
const TEST_DIR = join(tmpdir(), 'cah-empty-test-' + Date.now())

describe('Empty String Handling', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true })
    process.env.CAH_DATA_DIR = TEST_DIR
  })

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true })
    }
    delete process.env.CAH_DATA_DIR
  })

  describe('P0 Critical - Task Creation', () => {
    describe('createTaskWithFolder', () => {
      it('should handle empty description gracefully', () => {
        // 当前行为：createTaskWithFolder 会创建空标题的任务
        // 这是一个已知问题，但不会导致系统崩溃
        const task = createTaskWithFolder({ description: '' })

        expect(task).toBeDefined()
        expect(task.title).toBe('')
        expect(task.description).toBe('')

        // 任务 ID 仍会生成（基于时间戳）
        expect(task.id).toMatch(/^task-\d{8}-\d{6}/)
      })

      it('should handle whitespace-only description', () => {
        const task = createTaskWithFolder({ description: '   ' })

        expect(task).toBeDefined()
        expect(task.title).toBe('   ')
        expect(task.description).toBe('   ')
      })

      it('should handle short descriptions correctly', () => {
        const task = createTaskWithFolder({ description: 'ab' })

        expect(task.title).toBe('ab')
        expect(task.description).toBe('ab')
      })

      it('should truncate long descriptions at 47 chars', () => {
        const longDesc = 'A'.repeat(100)
        const task = createTaskWithFolder({ description: longDesc })

        expect(task.title).toBe('A'.repeat(47) + '...')
        expect(task.description).toBe(longDesc)
      })

      it('should handle empty assignee (optional field)', () => {
        const task = createTaskWithFolder({
          description: 'test',
          assignee: ''
        })

        expect(task.assignee).toBe('')
      })

      it('should default to medium priority for invalid priority', () => {
        const task = createTaskWithFolder({
          description: 'test',
          priority: ''
        })

        expect(task.priority).toBe('medium')
      })

      it('should default to medium priority for invalid priority values', () => {
        const task = createTaskWithFolder({
          description: 'test',
          priority: 'invalid'
        })

        expect(task.priority).toBe('medium')
      })
    })
  })

  describe('P0 Critical - Template System', () => {
    describe('createTemplate', () => {
      it('should handle empty template name', () => {
        // 当前行为：允许创建空名称的模板
        // 这可能会导致 ID 生成异常
        const template = createTemplate('', 'description', 'prompt')

        expect(template).toBeDefined()
        expect(template.name).toBe('')
        // ID 会基于空字符串生成
        expect(template.id).toMatch(/-[a-z0-9]+$/)
      })

      it('should handle empty template prompt', () => {
        // 当前行为：允许创建空 prompt 的模板
        // 这会导致任务执行失败
        const template = createTemplate('test', 'description', '')

        expect(template).toBeDefined()
        expect(template.prompt).toBe('')
      })

      it('should handle empty template description', () => {
        // description 为空是可以容忍的（非关键字段）
        const template = createTemplate('test', '', 'prompt')

        expect(template).toBeDefined()
        expect(template.description).toBe('')
      })

      it('should handle whitespace in template name', () => {
        const template = createTemplate('   ', 'desc', 'prompt')

        expect(template.name).toBe('   ')
      })
    })

    describe('applyTemplate', () => {
      it('should handle variables with empty default values', () => {
        const template = createTemplate(
          'test-template',
          'Test template',
          'Task: {{task}}, Priority: {{priority}}',
          {
            variables: [
              { name: 'task', description: 'Task name', defaultValue: '' },
              { name: 'priority', description: 'Priority', defaultValue: 'medium' },
            ],
          }
        )

        const result = applyTemplate(template.id, {})

        expect(result).toBeDefined()
        // 变量会被替换为空字符串或默认值
        expect(result).toContain('Task: ')
        expect(result).toContain('Priority: medium')
      })

      it('should handle all variables missing with empty defaults', () => {
        const template = createTemplate(
          'empty-vars',
          'Empty vars test',
          'Hello {{name}}',
          {
            variables: [
              { name: 'name', description: 'Name', defaultValue: '' },
            ],
          }
        )

        const result = applyTemplate(template.id, {})

        // applyTemplate 会 trim() 结果，所以尾部空格会被移除
        expect(result).toBe('Hello')
      })

      it('should override empty defaults with provided values', () => {
        const template = createTemplate(
          'override-test',
          'Override test',
          'Name: {{name}}',
          {
            variables: [
              { name: 'name', description: 'Name', defaultValue: '' },
            ],
          }
        )

        const result = applyTemplate(template.id, { name: 'Alice' })

        expect(result).toBe('Name: Alice')
      })
    })
  })

  describe('P1 High - Title Generation', () => {
    describe('isGenericTitle', () => {
      it('should detect empty string as generic', () => {
        expect(isGenericTitle('')).toBe(true)
      })

      it('should detect whitespace as generic', () => {
        expect(isGenericTitle('   ')).toBe(true)
        expect(isGenericTitle('\t')).toBe(true)
        expect(isGenericTitle('\n')).toBe(true)
      })

      it('should detect very short titles as generic', () => {
        expect(isGenericTitle('a')).toBe(true)
        expect(isGenericTitle('ab')).toBe(true)
      })

      it('should detect common generic patterns', () => {
        expect(isGenericTitle('Task')).toBe(true)
        expect(isGenericTitle('Task 1')).toBe(true)
        expect(isGenericTitle('New Task')).toBe(true)
        expect(isGenericTitle('todo')).toBe(true)
        expect(isGenericTitle('Untitled')).toBe(true)
        expect(isGenericTitle('任务')).toBe(true)
        expect(isGenericTitle('新任务')).toBe(true)
      })

      it('should not detect specific titles as generic', () => {
        expect(isGenericTitle('Fix login bug')).toBe(false)
        expect(isGenericTitle('Implement user authentication')).toBe(false)
        expect(isGenericTitle('修复登录问题')).toBe(false)
      })
    })
  })

  describe('P2 Medium - Boundary Cases', () => {
    describe('Edge cases for all empty variants', () => {
      EMPTY_VARIANTS.forEach(({ value, name }) => {
        it(`should handle ${name} in task description`, () => {
          const task = createTaskWithFolder({ description: value })

          expect(task).toBeDefined()
          expect(task.description).toBe(value)
        })

        it(`should handle ${name} in template name`, () => {
          const template = createTemplate(value, 'desc', 'prompt')

          expect(template).toBeDefined()
          expect(template.name).toBe(value)
        })

        it(`should detect ${name} as generic title`, () => {
          expect(isGenericTitle(value)).toBe(true)
        })
      })
    })

    describe('Boundary values', () => {
      const boundaryValues = [
        { value: '', length: 0 },
        { value: 'a', length: 1 },
        { value: 'ab', length: 2 },
        { value: 'abc', length: 3 },
        { value: 'A'.repeat(47), length: 47 },
        { value: 'A'.repeat(48), length: 48 },
        { value: 'A'.repeat(100), length: 100 },
      ]

      boundaryValues.forEach(({ value, length }) => {
        it(`should handle ${length}-char description`, () => {
          const task = createTaskWithFolder({ description: value })

          expect(task.description).toBe(value)

          if (length <= 47) {
            expect(task.title).toBe(value)
          } else {
            expect(task.title).toBe(value.slice(0, 47) + '...')
          }
        })
      })
    })

    describe('Special characters', () => {
      const specialCases = [
        { value: '🎯', name: 'emoji' },
        { value: '中文', name: 'chinese' },
        { value: '123', name: 'numbers' },
        { value: '!@#$', name: 'symbols' },
        { value: 'a\nb', name: 'with newline' },
        { value: 'a\tb', name: 'with tab' },
      ]

      specialCases.forEach(({ value, name }) => {
        it(`should handle ${name} in task description`, () => {
          const task = createTaskWithFolder({ description: value })

          expect(task.description).toBe(value)
          expect(task.title).toBe(value)
        })

        it(`should handle ${name} in template name`, () => {
          const template = createTemplate(value, 'desc', 'prompt')

          expect(template.name).toBe(value)
        })
      })
    })
  })

  describe('P2 Medium - Storage Layer Tolerance', () => {
    it('should create task object with empty fields', () => {
      const task = createTaskWithFolder({
        description: '',
        assignee: ''
      })

      expect(task.id).toBeDefined()
      expect(task.title).toBe('')
      expect(task.description).toBe('')
      expect(task.assignee).toBe('')

      // createTaskWithFolder 会创建任务对象（具体的文件存储由 TaskStore 负责）
    })

    it('should save and load templates with empty fields', () => {
      const template = createTemplate('', '', '')

      expect(template.id).toBeDefined()

      // 验证可以重新读取
      const loaded = getTemplate(template.id)
      expect(loaded).toBeDefined()
      expect(loaded?.name).toBe('')
      expect(loaded?.description).toBe('')
      expect(loaded?.prompt).toBe('')
    })
  })
})
