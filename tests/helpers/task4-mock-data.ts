/**
 * 测试任务 4 的 Mock 数据生成器
 * 提供标准化的测试数据创建函数
 */

import type { Task, TaskPriority } from '../../src/types/task.js'
import type { Workflow, WorkflowNode, WorkflowEdge } from '../../src/workflow/types.js'
import { MOCK_CONFIG } from './task4-test-config.js'

/**
 * 生成唯一的任务 ID
 */
export function generateTaskId(prefix = 'concurrent-test'): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}-${timestamp}-${random}`
}

/**
 * 创建并发测试任务
 */
export function createConcurrentTestTask(options?: {
  description?: string
  priority?: TaskPriority
  id?: string
}): Task {
  const now = new Date().toISOString()

  return {
    id: options?.id ?? generateTaskId(),
    title: options?.description ?? '并发测试任务',
    description: options?.description ?? '这是一个用于并发创建测试的任务',
    priority: options?.priority ?? 'medium',
    status: 'pending',
    retryCount: 0,
    createdAt: now,
  }
}

/**
 * 批量创建并发测试任务
 */
export function createBatchConcurrentTestTasks(
  count: number,
  options?: {
    priority?: TaskPriority
    useCustomDescriptions?: boolean
  }
): Task[] {
  const tasks: Task[] = []
  const { taskDescriptions } = MOCK_CONFIG
  const priority = options?.priority ?? 'medium'

  for (let i = 0; i < count; i++) {
    let description: string

    if (options?.useCustomDescriptions) {
      const baseDesc = taskDescriptions[i % taskDescriptions.length]
      const batchNum = Math.floor(i / taskDescriptions.length) + 1
      description = batchNum > 1 ? `${baseDesc} (批次 ${batchNum})` : baseDesc
    } else {
      description = `并发测试任务 #${i + 1}`
    }

    tasks.push(
      createConcurrentTestTask({
        description,
        priority,
      })
    )
  }

  return tasks
}

/**
 * 创建简单的测试工作流
 */
export function createSimpleTestWorkflow(taskId: string): Workflow {
  const now = new Date().toISOString()
  const workflowId = `workflow-${taskId}`

  const nodes: WorkflowNode[] = [
    {
      id: 'start',
      type: 'start',
      name: '开始',
    },
    {
      id: 'test-task',
      type: 'task',
      name: '执行测试',
      description: '执行并发测试任务',
      task: {
        persona: 'coder',
        prompt: '执行一个简单的测试操作',
        timeout: 30000,
        retries: 1,
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
      to: 'test-task',
    },
    {
      id: 'edge-2',
      from: 'test-task',
      to: 'end',
    },
  ]

  return {
    id: workflowId,
    taskId,
    name: '并发测试工作流',
    description: '用于并发创建测试的简单工作流',
    version: '2.0',
    nodes,
    edges,
    variables: {
      test_mode: true,
      concurrent_test: true,
    },
    settings: {
      defaultTimeout: 30000,
      maxExecutionTime: 60000,
      debug: false,
    },
    createdAt: now,
  }
}

/**
 * 根据优先级分布创建混合优先级任务
 */
export function createMixedPriorityTasks(count: number): Task[] {
  const tasks: Task[] = []
  const { priorityDistribution } = MOCK_CONFIG

  // 计算各优先级任务数量
  const lowCount = Math.floor(count * priorityDistribution.low)
  const highCount = Math.floor(count * priorityDistribution.high)
  const mediumCount = count - lowCount - highCount

  // 创建各优先级任务
  const priorities: Array<{ priority: TaskPriority; count: number }> = [
    { priority: 'low', count: lowCount },
    { priority: 'medium', count: mediumCount },
    { priority: 'high', count: highCount },
  ]

  let taskIndex = 0
  for (const { priority, count: taskCount } of priorities) {
    for (let i = 0; i < taskCount; i++) {
      tasks.push(
        createConcurrentTestTask({
          description: `${priority}优先级任务 #${taskIndex + 1}`,
          priority,
        })
      )
      taskIndex++
    }
  }

  // 随机打乱任务顺序
  return shuffleArray(tasks)
}

/**
 * 创建包含自定义节点的工作流
 */
export function createCustomWorkflow(
  taskId: string,
  nodeCount: number
): Workflow {
  const now = new Date().toISOString()
  const workflowId = `workflow-${taskId}`

  const nodes: WorkflowNode[] = [
    {
      id: 'start',
      type: 'start',
      name: '开始',
    },
  ]

  // 添加自定义任务节点
  for (let i = 1; i <= nodeCount; i++) {
    nodes.push({
      id: `task-${i}`,
      type: 'task',
      name: `任务 ${i}`,
      task: {
        persona: 'coder',
        prompt: `执行任务 ${i}`,
        timeout: 30000,
      },
    })
  }

  nodes.push({
    id: 'end',
    type: 'end',
    name: '结束',
  })

  // 创建线性边连接
  const edges: WorkflowEdge[] = []
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `edge-${i + 1}`,
      from: nodes[i].id,
      to: nodes[i + 1].id,
    })
  }

  return {
    id: workflowId,
    taskId,
    name: `自定义工作流（${nodeCount}节点）`,
    description: `包含 ${nodeCount} 个任务节点的工作流`,
    version: '2.0',
    nodes,
    edges,
    variables: {
      test_mode: true,
      node_count: nodeCount,
    },
    createdAt: now,
  }
}

/**
 * 工具函数：随机打乱数组
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * 创建测试数据快照（用于调试）
 */
export interface TestDataSnapshot {
  tasks: Task[]
  workflows: Workflow[]
  metadata: {
    createdAt: string
    taskCount: number
    priorityBreakdown: Record<TaskPriority, number>
  }
}

/**
 * 生成测试数据快照
 */
export function createTestDataSnapshot(tasks: Task[]): TestDataSnapshot {
  const workflows = tasks.map(task => createSimpleTestWorkflow(task.id))

  const priorityBreakdown = tasks.reduce(
    (acc, task) => {
      acc[task.priority] = (acc[task.priority] || 0) + 1
      return acc
    },
    {} as Record<TaskPriority, number>
  )

  return {
    tasks,
    workflows,
    metadata: {
      createdAt: new Date().toISOString(),
      taskCount: tasks.length,
      priorityBreakdown,
    },
  }
}

/**
 * 验证任务数据完整性
 */
export function validateTaskData(task: Task): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!task.id) {
    errors.push('任务 ID 缺失')
  }

  if (!task.title) {
    errors.push('任务标题缺失')
  }

  if (!task.description) {
    errors.push('任务描述缺失')
  }

  if (!['low', 'medium', 'high'].includes(task.priority)) {
    errors.push(`无效的优先级: ${task.priority}`)
  }

  if (!task.createdAt) {
    errors.push('创建时间缺失')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * 验证工作流数据完整性
 */
export function validateWorkflowData(workflow: Workflow): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!workflow.id) {
    errors.push('工作流 ID 缺失')
  }

  if (!workflow.taskId) {
    errors.push('关联任务 ID 缺失')
  }

  if (!workflow.nodes || workflow.nodes.length === 0) {
    errors.push('工作流节点为空')
  }

  if (!workflow.edges || workflow.edges.length === 0) {
    errors.push('工作流边为空')
  }

  // 验证节点 ID 唯一性
  const nodeIds = workflow.nodes.map(n => n.id)
  if (new Set(nodeIds).size !== nodeIds.length) {
    errors.push('工作流包含重复的节点 ID')
  }

  // 验证边的起点和终点都存在
  for (const edge of workflow.edges) {
    if (!nodeIds.includes(edge.from)) {
      errors.push(`边 ${edge.id} 的起点 ${edge.from} 不存在`)
    }
    if (!nodeIds.includes(edge.to)) {
      errors.push(`边 ${edge.id} 的终点 ${edge.to} 不存在`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
