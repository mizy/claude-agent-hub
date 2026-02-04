/**
 * Medium 优先级测试数据工厂
 * 提供标准化的测试数据创建函数
 */

import type { Task, TaskPriority } from '../../src/types/task.js'
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowInstance } from '../../src/workflow/types.js'

/**
 * 创建 medium 优先级测试任务
 */
export function createMediumTestTask(overrides?: Partial<Task>): Task {
  const now = new Date().toISOString()
  const id = `test-task-${Date.now()}`

  return {
    id,
    title: 'Medium优先级测试任务',
    description: '这是一个用于测试 medium 优先级的测试任务',
    priority: 'medium' as TaskPriority,
    status: 'pending',
    retryCount: 0,
    createdAt: now,
    ...overrides,
  }
}

/**
 * 创建测试用 workflow 定义
 */
export function createTestWorkflow(taskId?: string): Workflow {
  const now = new Date().toISOString()
  const id = `test-workflow-${Date.now()}`

  const nodes: WorkflowNode[] = [
    {
      id: 'start',
      type: 'start',
      name: '开始',
    },
    {
      id: 'task-1',
      type: 'task',
      name: '执行测试任务',
      description: '这是一个简单的测试任务节点',
      task: {
        persona: 'coder',
        prompt: '执行一个简单的测试操作',
        timeout: 60000,
        retries: 2,
      },
    },
    {
      id: 'end',
      type: 'end',
      name: '结束',
    },
  ]

  const edges: WorkflowEdge[] = [
    {
      id: 'edge-1',
      from: 'start',
      to: 'task-1',
    },
    {
      id: 'edge-2',
      from: 'task-1',
      to: 'end',
    },
  ]

  return {
    id,
    taskId,
    name: 'Medium优先级测试工作流',
    description: '用于测试 medium 优先级任务的简单工作流',
    version: '2.0',
    nodes,
    edges,
    variables: {
      test_mode: true,
      priority: 'medium',
    },
    settings: {
      defaultTimeout: 30000,
      maxExecutionTime: 300000,
      debug: true,
    },
    createdAt: now,
  }
}

/**
 * 创建测试用 workflow instance
 */
export function createTestWorkflowInstance(workflowId: string): WorkflowInstance {
  const now = new Date().toISOString()
  const id = `test-instance-${Date.now()}`

  return {
    id,
    workflowId,
    status: 'pending',
    nodeStates: {
      start: {
        status: 'pending',
        attempts: 0,
      },
      'task-1': {
        status: 'pending',
        attempts: 0,
      },
      end: {
        status: 'pending',
        attempts: 0,
      },
    },
    variables: {
      test_mode: true,
      priority: 'medium',
    },
    outputs: {},
    loopCounts: {},
    startedAt: now,
  }
}

/**
 * 创建复杂的 workflow（包含多个节点类型）
 */
export function createComplexTestWorkflow(taskId?: string): Workflow {
  const now = new Date().toISOString()
  const id = `test-workflow-complex-${Date.now()}`

  const nodes: WorkflowNode[] = [
    {
      id: 'start',
      type: 'start',
      name: '开始',
    },
    {
      id: 'task-1',
      type: 'task',
      name: '任务1',
      task: {
        persona: 'coder',
        prompt: '执行编码任务',
        timeout: 60000,
      },
    },
    {
      id: 'task-2',
      type: 'task',
      name: '任务2',
      task: {
        persona: 'reviewer',
        prompt: '执行代码审查',
        timeout: 60000,
      },
    },
    {
      id: 'condition-1',
      type: 'condition',
      name: '检查结果',
      condition: {
        expression: 'outputs["task-1"].success === true',
      },
    },
    {
      id: 'end',
      type: 'end',
      name: '结束',
    },
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-1', from: 'start', to: 'task-1' },
    { id: 'edge-2', from: 'task-1', to: 'condition-1' },
    { id: 'edge-3', from: 'condition-1', to: 'task-2', condition: 'true' },
    { id: 'edge-4', from: 'condition-1', to: 'end', condition: 'false' },
    { id: 'edge-5', from: 'task-2', to: 'end' },
  ]

  return {
    id,
    taskId,
    name: '复杂测试工作流',
    description: '包含条件分支的复杂工作流',
    version: '2.0',
    nodes,
    edges,
    variables: {
      test_mode: true,
      priority: 'medium',
    },
    createdAt: now,
  }
}

/**
 * 测试环境配置
 */
export interface TestConfig {
  dataDir: string
  testTimeout: number
  cleanupAfterTest: boolean
}

/**
 * 获取测试配置
 */
export function getTestConfig(): TestConfig {
  return {
    dataDir: process.env.CAH_DATA_DIR || '.cah-data',
    testTimeout: 30000,
    cleanupAfterTest: true,
  }
}

/**
 * 批量创建测试任务
 */
export function createBatchTestTasks(count: number, priority: TaskPriority = 'medium'): Task[] {
  const tasks: Task[] = []
  const now = Date.now()

  for (let i = 0; i < count; i++) {
    tasks.push(
      createMediumTestTask({
        id: `test-task-batch-${now}-${i}`,
        title: `批量测试任务 #${i + 1}`,
        description: `这是第 ${i + 1} 个测试任务`,
        priority,
      })
    )
  }

  return tasks
}

/**
 * 并发测试场景配置
 */
export interface ConcurrentTestScenario {
  name: string
  description: string
  taskCount: number
  expectedBehavior: string
}

/**
 * 并发测试场景定义
 */
export const concurrentTestScenarios: ConcurrentTestScenario[] = [
  {
    name: '小规模并发',
    description: '3个任务同时创建',
    taskCount: 3,
    expectedBehavior: '所有任务应成功创建且ID唯一',
  },
  {
    name: '中等规模并发',
    description: '5个任务同时创建',
    taskCount: 5,
    expectedBehavior: '所有任务应成功创建且ID唯一',
  },
  {
    name: '大规模并发',
    description: '10个任务同时创建',
    taskCount: 10,
    expectedBehavior: '所有任务应成功创建且ID唯一',
  },
]

/**
 * 创建并发测试任务描述
 */
export function createConcurrentTaskDescriptions(count: number): string[] {
  const descriptions: string[] = []
  const baseDescriptions = [
    '分析项目代码结构',
    '生成测试报告',
    '优化性能瓶颈',
    '重构核心模块',
    '更新文档',
    '修复已知bug',
    '添加新功能',
    '执行代码审查',
    '集成新依赖',
    '部署到生产环境',
  ]

  for (let i = 0; i < count; i++) {
    const baseDesc = baseDescriptions[i % baseDescriptions.length]
    descriptions.push(`${baseDesc} #${Math.floor(i / baseDescriptions.length) + 1}`)
  }

  return descriptions
}

/**
 * 创建并发测试任务（用于实际测试）
 */
export function createConcurrentTestTasks(count: number): Array<{
  description: string
  priority: TaskPriority
}> {
  const descriptions = createConcurrentTaskDescriptions(count)
  const priorities: TaskPriority[] = ['low', 'medium', 'high']

  return descriptions.map((description, index) => ({
    description,
    priority: priorities[index % priorities.length],
  }))
}

/**
 * 验证任务创建结果
 */
export interface TaskCreationResult {
  taskId: string
  success: boolean
  error?: string
  createdAt: number
}

/**
 * 验证并发创建结果
 */
export function validateConcurrentCreation(results: TaskCreationResult[]): {
  success: boolean
  uniqueIds: boolean
  allCreated: boolean
  errors: string[]
} {
  const taskIds = results.map(r => r.taskId)
  const uniqueIds = new Set(taskIds).size === taskIds.length
  const allCreated = results.every(r => r.success)
  const errors = results.filter(r => !r.success).map(r => r.error || 'Unknown error')

  return {
    success: uniqueIds && allCreated,
    uniqueIds,
    allCreated,
    errors,
  }
}
