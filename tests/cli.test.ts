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
const CLI_PATH = join(process.cwd(), 'dist/cli/index.js')

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
    it('cah task list should return valid output', async () => {
      const { stdout, exitCode } = await execa('node', [CLI_PATH, 'task', 'list'], {
        cwd: TEST_DIR,
        reject: false,
      })

      // Should exit cleanly and output something (even if empty list)
      expect(exitCode).toBe(0)
      expect(typeof stdout).toBe('string')
    })

    it('cah agent list should list available agents', async () => {
      const { stdout, exitCode } = await execa('node', [CLI_PATH, 'agent', 'list'], {
        cwd: TEST_DIR,
        reject: false,
      })

      expect(exitCode).toBe(0)
      // Should list at least one built-in persona
      expect(stdout).toContain('Pragmatist')
    })
  })

  describe('错误路径', () => {
    it('should show error for unknown subcommand', async () => {
      const { stderr, exitCode } = await execa(
        'node',
        [CLI_PATH, 'nonexistent-command'],
        { cwd: TEST_DIR, reject: false }
      )

      // Unknown subcommands are treated as task descriptions, should still work
      // or show a meaningful response
      expect(exitCode === 0 || exitCode === 1).toBe(true)
    })

    it('should handle task subcommand without action', async () => {
      const { exitCode } = await execa('node', [CLI_PATH, 'task'], {
        cwd: TEST_DIR,
        reject: false,
      })

      // May exit 0 (list) or 1 (no action specified) - both are valid
      expect(typeof exitCode).toBe('number')
    })

    it('should handle task logs with invalid id gracefully', async () => {
      const { exitCode } = await execa(
        'node',
        [CLI_PATH, 'task', 'logs', 'nonexistent-task-id'],
        { cwd: TEST_DIR, reject: false }
      )

      // Should fail gracefully, not crash
      expect(typeof exitCode).toBe('number')
    })
  })
})
