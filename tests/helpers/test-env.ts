/**
 * 测试环境设置和清理工具
 * 提供统一的测试环境初始化和清理机制
 */

import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { createTaskFolder, saveTask, getTask } from '../../src/store/TaskStore.js'
import { saveTaskWorkflow, getTaskWorkflow, saveTaskInstance, getTaskInstance } from '../../src/store/TaskWorkflowStore.js'
import type { Task } from '../../src/types/task.js'
import type { Workflow, WorkflowInstance } from '../../src/workflow/types.js'

/**
 * 测试环境配置
 */
export interface TestEnvConfig {
  dataDir: string
  cleanupOnExit: boolean
  mockClaudeCode: boolean
}

/**
 * 测试环境管理器
 */
export class TestEnvironment {
  private config: TestEnvConfig
  private createdTaskIds: string[] = []

  constructor(config: Partial<TestEnvConfig> = {}) {
    const testId = Date.now()
    this.config = {
      dataDir: config.dataDir || join('/tmp', `cah-test-${testId}`),
      cleanupOnExit: config.cleanupOnExit ?? true,
      mockClaudeCode: config.mockClaudeCode ?? true,
    }

    // 设置环境变量
    process.env.CAH_DATA_DIR = this.config.dataDir
  }

  /**
   * 初始化测试环境
   */
  async setup(): Promise<void> {
    // 清理旧数据
    if (existsSync(this.config.dataDir)) {
      rmSync(this.config.dataDir, { recursive: true, force: true })
    }

    // 创建数据目录
    mkdirSync(this.config.dataDir, { recursive: true })
  }

  /**
   * 清理测试环境
   */
  async cleanup(): Promise<void> {
    if (this.config.cleanupOnExit && existsSync(this.config.dataDir)) {
      rmSync(this.config.dataDir, { recursive: true, force: true })
    }

    // 清理环境变量
    delete process.env.CAH_DATA_DIR
  }

  /**
   * 创建测试任务
   */
  async createTask(task: Task): Promise<string> {
    createTaskFolder(task.id)
    saveTask(task)
    this.createdTaskIds.push(task.id)
    return task.id
  }

  /**
   * 创建 Workflow
   */
  async createWorkflow(taskId: string, workflow: Workflow): Promise<string> {
    saveTaskWorkflow(taskId, workflow)
    return workflow.id
  }

  /**
   * 创建 Workflow Instance
   */
  async createInstance(taskId: string, instance: WorkflowInstance): Promise<string> {
    saveTaskInstance(taskId, instance)
    return instance.id
  }

  /**
   * 获取任务
   */
  async getTask(taskId: string): Promise<Task | null> {
    return getTask(taskId)
  }

  /**
   * 获取 Workflow
   */
  async getWorkflow(taskId: string): Promise<Workflow | null> {
    return getTaskWorkflow(taskId)
  }

  /**
   * 获取 Instance
   */
  async getInstance(taskId: string): Promise<WorkflowInstance | null> {
    return getTaskInstance(taskId)
  }

  /**
   * 获取数据目录路径
   */
  getDataDir(): string {
    return this.config.dataDir
  }

  /**
   * 获取任务目录路径
   */
  getTaskDir(taskId: string): string {
    return join(this.config.dataDir, 'tasks', taskId)
  }

  /**
   * 验证文件存在
   */
  fileExists(relativePath: string): boolean {
    return existsSync(join(this.config.dataDir, relativePath))
  }

  /**
   * 获取所有创建的任务ID
   */
  getCreatedTaskIds(): string[] {
    return [...this.createdTaskIds]
  }
}

/**
 * 快速创建测试环境（用于测试前的 beforeEach）
 */
export async function setupTestEnv(config?: Partial<TestEnvConfig>): Promise<TestEnvironment> {
  const env = new TestEnvironment(config)
  await env.setup()
  return env
}

/**
 * 快速清理测试环境（用于测试后的 afterEach）
 */
export async function cleanupTestEnv(env: TestEnvironment): Promise<void> {
  await env.cleanup()
}

/**
 * 模拟 Claude Code 执行
 * 用于测试时避免真实调用 Claude Code CLI
 */
export class MockClaudeCode {
  private responses: Map<string, string> = new Map()

  /**
   * 设置模拟响应
   */
  mockResponse(nodeId: string, response: string): void {
    this.responses.set(nodeId, response)
  }

  /**
   * 模拟执行
   */
  async execute(nodeId: string, prompt: string): Promise<string> {
    const response = this.responses.get(nodeId)
    if (response) {
      return response
    }

    // 默认成功响应
    return `Mock response for node ${nodeId}: Successfully executed "${prompt}"`
  }

  /**
   * 清理所有模拟
   */
  clear(): void {
    this.responses.clear()
  }
}

/**
 * 等待条件满足（用于异步测试）
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  options: {
    timeout?: number
    interval?: number
    errorMessage?: string
  } = {}
): Promise<void> {
  const {
    timeout = 5000,
    interval = 100,
    errorMessage = 'Condition not met within timeout',
  } = options

  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const result = await condition()
    if (result) {
      return
    }
    await sleep(interval)
  }

  throw new Error(`${errorMessage} (timeout: ${timeout}ms)`)
}

/**
 * 延迟辅助函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 创建测试套件钩子
 */
export function createTestHooks() {
  let env: TestEnvironment

  return {
    async beforeEach(config?: Partial<TestEnvConfig>) {
      env = await setupTestEnv(config)
      return env
    },

    async afterEach() {
      if (env) {
        await cleanupTestEnv(env)
      }
    },

    getEnv() {
      return env
    },
  }
}
