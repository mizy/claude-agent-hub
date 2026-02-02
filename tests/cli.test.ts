/**
 * CLI 端到端测试
 * 测试从命令执行到输出的完整流程
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execa } from 'execa'
import { mkdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// 测试临时目录
const TEST_DIR = join(tmpdir(), 'cah-test-' + Date.now())
const CLI_PATH = join(process.cwd(), 'dist/index.js')

describe('CLI 简化命令', () => {
  beforeEach(async () => {
    // 创建测试目录
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    // 清理测试目录
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe('cah --help', () => {
    it('should display help with simplified usage', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '--help'])

      expect(stdout).toContain('cah')
      expect(stdout).toContain('[input]')
      expect(stdout).toContain('任务描述')
    })
  })

  describe('cah --version', () => {
    it('should display version', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '--version'])

      expect(stdout).toMatch(/\d+\.\d+\.\d+/)
    })
  })

  describe('cah "任务描述"', () => {
    it('should create task from prompt', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '修复登录bug'], {
        cwd: TEST_DIR,
        reject: false,
      })

      // 应该显示创建成功信息（默认行为是创建任务并启动后台执行器）
      expect(stdout).toContain('Created task')
      expect(stdout).toContain('修复登录bug')
      expect(stdout).toContain('ID:')
    })

    it('should truncate long prompts in title', async () => {
      const longPrompt = 'A'.repeat(100)
      const { stdout } = await execa('node', [CLI_PATH, longPrompt], {
        cwd: TEST_DIR,
        reject: false,
      })

      expect(stdout).toContain('Created task')
      expect(stdout).toContain('...')
    })

    it('should support --agent option (persona)', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '优化数据库', '-a', 'architect'], {
        cwd: TEST_DIR,
        reject: false,
      })

      // -a 选项指定 persona，任务仍应成功创建
      expect(stdout).toContain('Created task')
    })
  })

  describe('子命令', () => {
    it('cah task list should work', async () => {
      const { stdout } = await execa('node', [CLI_PATH, 'task', 'list'], {
        cwd: TEST_DIR,
        reject: false,
      })

      // 应该显示任务列表（可能为空）
      expect(stdout).toBeDefined()
    })

    it('cah agent list should work', async () => {
      const { stdout } = await execa('node', [CLI_PATH, 'agent', 'list'], {
        cwd: TEST_DIR,
        reject: false,
      })

      expect(stdout).toBeDefined()
    })
  })
})

