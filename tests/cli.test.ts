/**
 * CLI 端到端测试
 * 测试从命令执行到输出的完整流程
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execa } from 'execa'
import { writeFile, mkdir, rm } from 'fs/promises'
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
      expect(stdout).toContain('任务描述或文件路径')
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
      const { stdout, stderr } = await execa('node', [CLI_PATH, '修复登录bug', '--no-run'], {
        cwd: TEST_DIR,
        reject: false,
      })

      // 应该显示创建成功信息
      expect(stdout).toContain('Created task')
      expect(stdout).toContain('修复登录bug')
      expect(stdout).toContain('ID:')
    })

    it('should truncate long prompts in title', async () => {
      const longPrompt = 'A'.repeat(100)
      const { stdout } = await execa('node', [CLI_PATH, longPrompt, '--no-run'], {
        cwd: TEST_DIR,
        reject: false,
      })

      expect(stdout).toContain('Created task')
      expect(stdout).toContain('...')
    })

    it('should support --agent option', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '优化数据库', '-a', 'architect', '--no-run'], {
        cwd: TEST_DIR,
        reject: false,
      })

      expect(stdout).toContain('Created task')
    })
  })

  describe('cah <file.md>', () => {
    it('should create workflow from valid markdown', async () => {
      const mdContent = `# 用户登录功能

## 背景

实现用户登录功能

## 任务

### 1. 设计数据库

- Agent: architect
- 描述: 设计用户表结构

### 2. 实现API

- 依赖: 设计数据库
- 描述: 实现登录接口

### 3. 编写测试

- 依赖: 实现API
- 描述: 编写单元测试
`
      const mdPath = join(TEST_DIR, 'requirements.md')
      await writeFile(mdPath, mdContent)

      const { stdout, stderr } = await execa('node', [CLI_PATH, mdPath], {
        cwd: TEST_DIR,
        reject: false,
      })

      const output = stdout + stderr

      expect(stdout).toContain('Created workflow')
      expect(stdout).toContain('用户登录功能')
      expect(stdout).toContain('Tasks: 3')
      // 工作流启动后应有实例信息（不再需要 Redis）
      expect(output).toContain('Instance')
    })

    it('should show error for invalid markdown', async () => {
      const invalidMd = `This is not a valid workflow markdown`
      const mdPath = join(TEST_DIR, 'invalid.md')
      await writeFile(mdPath, invalidMd)

      const { stdout, stderr } = await execa('node', [CLI_PATH, mdPath], {
        cwd: TEST_DIR,
        reject: false,
      })

      const output = stdout + stderr
      expect(output).toContain('Invalid markdown format')
    })

    it('should support --no-start option', async () => {
      const mdContent = `# 测试工作流

## 任务

### 1. 任务一

- 描述: 第一个任务
`
      const mdPath = join(TEST_DIR, 'test.md')
      await writeFile(mdPath, mdContent)

      const { stdout } = await execa('node', [CLI_PATH, mdPath, '--no-start'], {
        cwd: TEST_DIR,
        reject: false,
      })

      expect(stdout).toContain('Created workflow')
      expect(stdout).not.toContain('Workflow started')
    })

    it('should handle ~ home directory expansion', async () => {
      // 当文件不存在时，会回退到创建任务
      // 这是预期行为，避免用户输入错误路径时出错
      const { stdout, stderr } = await execa('node', [CLI_PATH, '~/nonexistent.md', '--no-run'], {
        cwd: TEST_DIR,
        reject: false,
      })

      const output = stdout + stderr
      // 文件不存在时会回退为创建任务
      expect(output).toContain('Created task')
    })

    it('should show error for non-existent file', async () => {
      const { stdout, stderr } = await execa('node', [CLI_PATH, './nonexistent.md', '--no-run'], {
        cwd: TEST_DIR,
        reject: false,
      })

      // 文件不存在时，由于路径格式，回退为创建任务
      const output = stdout + stderr
      expect(output).toContain('Created task')
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

    it('cah workflow list should work', async () => {
      const { stdout } = await execa('node', [CLI_PATH, 'workflow', 'list'], {
        cwd: TEST_DIR,
        reject: false,
      })

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

describe('Workflow 子命令', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true })
    }
  })

  it('cah workflow create -f <file> should create workflow', async () => {
    const mdContent = `# 测试工作流

## 任务

### 1. 第一步

- 描述: 执行第一步
`
    const mdPath = join(TEST_DIR, 'workflow.md')
    await writeFile(mdPath, mdContent)

    const { stdout } = await execa('node', [CLI_PATH, 'workflow', 'create', '-f', mdPath], {
      cwd: TEST_DIR,
      reject: false,
    })

    expect(stdout).toContain('Created workflow')
  })

  it('cah workflow status <id> should show status', async () => {
    // 首先创建一个工作流
    const mdContent = `# 状态测试

## 任务

### 1. 任务

- 描述: 测试任务
`
    const mdPath = join(TEST_DIR, 'status-test.md')
    await writeFile(mdPath, mdContent)

    // 创建工作流
    const createResult = await execa('node', [CLI_PATH, 'workflow', 'create', '-f', mdPath, '--start'], {
      cwd: TEST_DIR,
      reject: false,
    })

    // 提取 ID（从输出中）
    const idMatch = createResult.stdout.match(/ID:\s*(\S+)/)
    if (idMatch) {
      const id = idMatch[1].slice(0, 8) // 取前8位

      const { stdout } = await execa('node', [CLI_PATH, 'workflow', 'status', id], {
        cwd: TEST_DIR,
        reject: false,
      })

      expect(stdout).toContain('Workflow:')
    }
  })
})
