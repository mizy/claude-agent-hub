/**
 * 简化命令 (run) 测试
 * 测试输入类型判断和路径处理逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// 模拟 isFilePath 函数的逻辑（与 run.ts 中相同）
function isFilePath(input: string): boolean {
  return (
    input.startsWith('./') ||
    input.startsWith('../') ||
    input.startsWith('/') ||
    input.startsWith('~') ||
    /\.\w+$/.test(input)
  )
}

describe('isFilePath 判断逻辑', () => {
  describe('应该识别为文件路径', () => {
    it('以 ./ 开头', () => {
      expect(isFilePath('./test.md')).toBe(true)
      expect(isFilePath('./folder/file.txt')).toBe(true)
    })

    it('以 ../ 开头', () => {
      expect(isFilePath('../test.md')).toBe(true)
      expect(isFilePath('../parent/file.txt')).toBe(true)
    })

    it('以 / 开头（绝对路径）', () => {
      expect(isFilePath('/Users/test/file.md')).toBe(true)
      expect(isFilePath('/tmp/workflow.md')).toBe(true)
    })

    it('以 ~ 开头（home目录）', () => {
      expect(isFilePath('~/projects/prd.md')).toBe(true)
      expect(isFilePath('~/file.txt')).toBe(true)
    })

    it('包含文件扩展名', () => {
      expect(isFilePath('file.md')).toBe(true)
      expect(isFilePath('document.txt')).toBe(true)
      expect(isFilePath('config.yaml')).toBe(true)
      expect(isFilePath('script.js')).toBe(true)
    })
  })

  describe('应该识别为任务描述', () => {
    it('普通文本', () => {
      expect(isFilePath('修复登录bug')).toBe(false)
      expect(isFilePath('添加用户认证功能')).toBe(false)
    })

    it('包含空格的描述', () => {
      expect(isFilePath('fix the login bug')).toBe(false)
      expect(isFilePath('add new feature')).toBe(false)
    })

    it('包含特殊字符但不是路径', () => {
      expect(isFilePath('fix bug #123')).toBe(false)
      expect(isFilePath('update API v2')).toBe(false)
    })

    it('不以路径符号开头且无扩展名', () => {
      expect(isFilePath('readme')).toBe(false)
      expect(isFilePath('TODO')).toBe(false)
    })
  })

  describe('边界情况', () => {
    it('只有扩展名的边界', () => {
      // .md 被认为是以 . 开头的隐藏文件路径
      expect(isFilePath('.md')).toBe(true)
      expect(isFilePath('.gitignore')).toBe(true)
    })

    it('包含点但不是扩展名', () => {
      // v1.2功能更新 不会被识别为文件路径，因为不以 .\w+ 结尾
      expect(isFilePath('v1.2功能更新')).toBe(false)
      // v1.2 会被识别为文件路径（误判）
      expect(isFilePath('v1.2')).toBe(true)
    })
  })
})

describe('路径展开', () => {
  it('should expand ~ to home directory', () => {
    const input = '~/projects/test.md'
    const home = process.env.HOME || ''
    const expanded = input.replace('~', home)

    expect(expanded).toBe(`${home}/projects/test.md`)
    expect(expanded).not.toContain('~')
  })

  it('should not modify paths without ~', () => {
    const input = '/absolute/path/file.md'
    const expanded = input.startsWith('~')
      ? input.replace('~', process.env.HOME || '')
      : input

    expect(expanded).toBe(input)
  })
})

describe('Markdown 文件检测', () => {
  const TEST_DIR = join(tmpdir(), 'cah-run-test-' + Date.now())

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true })
    }
  })

  it('should detect .md extension', () => {
    const ext = 'test.md'.split('.').pop()?.toLowerCase()
    expect(ext).toBe('md')
  })

  it('should detect .markdown extension', () => {
    const ext = 'test.markdown'.split('.').pop()?.toLowerCase()
    expect(ext).toBe('markdown')
  })

  it('should handle files without extension', () => {
    const ext = 'README'.split('.').pop()?.toLowerCase()
    expect(ext).toBe('readme') // 整个文件名
  })

  it('should handle files with multiple dots', () => {
    const ext = 'file.test.md'.split('.').pop()?.toLowerCase()
    expect(ext).toBe('md')
  })
})

describe('输入处理完整流程', () => {
  // 模拟完整的输入处理逻辑
  function processInput(input: string): 'task' | 'workflow' | 'unknown' {
    const expandedPath = input.startsWith('~')
      ? input.replace('~', '/home/user')
      : input

    if (!isFilePath(input)) {
      return 'task'
    }

    // 假设文件存在的情况
    const ext = expandedPath.split('.').pop()?.toLowerCase()
    if (ext === 'md' || ext === 'markdown') {
      return 'workflow'
    }

    return 'task' // 其他文件类型当作任务处理
  }

  it('should route prompt to task', () => {
    expect(processInput('修复登录bug')).toBe('task')
    expect(processInput('添加新功能')).toBe('task')
  })

  it('should route markdown files to workflow', () => {
    expect(processInput('./requirements.md')).toBe('workflow')
    expect(processInput('~/projects/prd.md')).toBe('workflow')
    expect(processInput('/path/to/workflow.markdown')).toBe('workflow')
  })

  it('should route other files to task', () => {
    expect(processInput('./notes.txt')).toBe('task')
    expect(processInput('./config.json')).toBe('task')
  })
})
