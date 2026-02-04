/**
 * Workflow 节点执行测试数据工厂
 * 为高优先级测试场景提供标准化的测试数据
 */

import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowInstance, NodeJobData } from '../../src/workflow/types.js'
import type { Task } from '../../src/types/task.js'

/**
 * 创建简单的任务节点
 */
export function createTaskNode(id: string, name: string, persona: string = 'coder'): WorkflowNode {
  return {
    id,
    type: 'task',
    name,
    task: {
      persona,
      prompt: `执行 ${name}`,
      timeout: 60000,
      retries: 2,
    },
  }
}

/**
 * 创建条件节点
 */
export function createConditionNode(id: string, name: string, expression: string): WorkflowNode {
  return {
    id,
    type: 'condition',
    name,
    condition: {
      expression,
    },
  }
}

/**
 * 创建循环节点
 */
export function createLoopNode(id: string, name: string, maxIterations: number = 3): WorkflowNode {
  return {
    id,
    type: 'loop',
    name,
    loop: {
      condition: 'variables.counter < variables.maxCount',
      maxIterations,
    },
  }
}

/**
 * 测试场景：简单线性工作流
 */
export function createLinearWorkflow(taskId?: string): Workflow {
  const now = new Date().toISOString()
  const id = `test-workflow-linear-${Date.now()}`

  const nodes: WorkflowNode[] = [
    { id: 'start', type: 'start', name: '开始' },
    createTaskNode('task-1', '任务1'),
    createTaskNode('task-2', '任务2'),
    { id: 'end', type: 'end', name: '结束' },
  ]

  const edges: WorkflowEdge[] = [
    { id: 'e1', from: 'start', to: 'task-1' },
    { id: 'e2', from: 'task-1', to: 'task-2' },
    { id: 'e3', from: 'task-2', to: 'end' },
  ]

  return {
    id,
    taskId,
    name: '线性工作流',
    description: '测试简单的顺序执行',
    version: '2.0',
    nodes,
    edges,
    variables: {},
    createdAt: now,
  }
}

/**
 * 测试场景：条件分支工作流
 */
export function createConditionalWorkflow(taskId?: string): Workflow {
  const now = new Date().toISOString()
  const id = `test-workflow-conditional-${Date.now()}`

  const nodes: WorkflowNode[] = [
    { id: 'start', type: 'start', name: '开始' },
    createTaskNode('task-1', '任务1'),
    createConditionNode('condition-1', '检查结果', 'outputs["task-1"].success === true'),
    createTaskNode('task-success', '成功处理'),
    createTaskNode('task-failure', '失败处理'),
    { id: 'end', type: 'end', name: '结束' },
  ]

  const edges: WorkflowEdge[] = [
    { id: 'e1', from: 'start', to: 'task-1' },
    { id: 'e2', from: 'task-1', to: 'condition-1' },
    { id: 'e3', from: 'condition-1', to: 'task-success', condition: 'true' },
    { id: 'e4', from: 'condition-1', to: 'task-failure', condition: 'false' },
    { id: 'e5', from: 'task-success', to: 'end' },
    { id: 'e6', from: 'task-failure', to: 'end' },
  ]

  return {
    id,
    taskId,
    name: '条件分支工作流',
    description: '测试条件分支逻辑',
    version: '2.0',
    nodes,
    edges,
    variables: {},
    createdAt: now,
  }
}

/**
 * 测试场景：循环工作流
 */
export function createLoopWorkflow(taskId?: string, maxIterations: number = 3): Workflow {
  const now = new Date().toISOString()
  const id = `test-workflow-loop-${Date.now()}`

  const nodes: WorkflowNode[] = [
    { id: 'start', type: 'start', name: '开始' },
    createLoopNode('loop-1', '循环执行', maxIterations),
    createTaskNode('task-1', '循环体任务'),
    { id: 'end', type: 'end', name: '结束' },
  ]

  const edges: WorkflowEdge[] = [
    { id: 'e1', from: 'start', to: 'loop-1' },
    { id: 'e2', from: 'loop-1', to: 'task-1' },
    { id: 'e3', from: 'task-1', to: 'loop-1' },
    { id: 'e4', from: 'loop-1', to: 'end' },
  ]

  return {
    id,
    taskId,
    name: '循环工作流',
    description: '测试循环逻辑',
    version: '2.0',
    nodes,
    edges,
    variables: {
      counter: 0,
      maxCount: maxIterations,
    },
    createdAt: now,
  }
}

/**
 * 测试场景：失败重试工作流
 */
export function createRetryWorkflow(taskId?: string): Workflow {
  const now = new Date().toISOString()
  const id = `test-workflow-retry-${Date.now()}`

  const nodes: WorkflowNode[] = [
    { id: 'start', type: 'start', name: '开始' },
    {
      id: 'task-flaky',
      type: 'task',
      name: '可能失败的任务',
      task: {
        persona: 'coder',
        prompt: '执行可能失败的操作',
        timeout: 30000,
        retries: 3, // 允许重试 3 次
      },
    },
    { id: 'end', type: 'end', name: '结束' },
  ]

  const edges: WorkflowEdge[] = [
    { id: 'e1', from: 'start', to: 'task-flaky' },
    { id: 'e2', from: 'task-flaky', to: 'end' },
  ]

  return {
    id,
    taskId,
    name: '重试测试工作流',
    description: '测试节点失败重试逻辑',
    version: '2.0',
    nodes,
    edges,
    variables: {},
    createdAt: now,
  }
}

/**
 * 创建 Workflow Instance
 * @param workflowId - 工作流 ID
 * @param optionsOrNodeIds - 可以是 options 对象或 nodeIds 数组（兼容旧 API）
 * @param legacyOptions - 旧 API 的 options（当第二个参数是 nodeIds 时使用）
 */
export function createWorkflowInstance(
  workflowId: string,
  optionsOrNodeIds?: {
    taskId?: string
    allPending?: boolean
    allCompleted?: boolean
    currentNodeId?: string
    nodeIds?: string[]
  } | string[],
  legacyOptions?: {
    allPending?: boolean
    allCompleted?: boolean
    currentNodeId?: string
  }
): WorkflowInstance {
  const now = new Date().toISOString()
  const id = `test-instance-${Date.now()}`

  // 兼容两种调用方式
  let nodeIds: string[] = []
  let options: { allPending?: boolean; allCompleted?: boolean; currentNodeId?: string } = {}

  if (Array.isArray(optionsOrNodeIds)) {
    // 旧 API: createWorkflowInstance(workflowId, nodeIds, options)
    nodeIds = optionsOrNodeIds
    options = legacyOptions || {}
  } else if (optionsOrNodeIds) {
    // 新 API: createWorkflowInstance(workflowId, { nodeIds?, ... })
    nodeIds = optionsOrNodeIds.nodeIds || []
    options = optionsOrNodeIds
  }

  const nodeStates: WorkflowInstance['nodeStates'] = {}

  for (const nodeId of nodeIds) {
    if (options.allCompleted) {
      nodeStates[nodeId] = {
        status: 'completed',
        attempts: 1,
        startedAt: now,
        completedAt: now,
      }
    } else if (options.currentNodeId === nodeId) {
      nodeStates[nodeId] = {
        status: 'running',
        attempts: 1,
        startedAt: now,
      }
    } else {
      nodeStates[nodeId] = {
        status: 'pending',
        attempts: 0,
      }
    }
  }

  return {
    id,
    workflowId,
    status: options.allCompleted ? 'completed' : 'running',
    nodeStates,
    variables: {},
    outputs: {},
    loopCounts: {},
    startedAt: now,
    completedAt: options.allCompleted ? now : undefined,
  }
}

/**
 * 创建节点任务数据（用于 NodeWorker）
 */
export function createNodeJobData(
  workflowId: string,
  instanceId: string,
  nodeId: string,
  attempt: number = 1
): NodeJobData {
  return {
    workflowId,
    instanceId,
    nodeId,
    attempt,
  }
}

/**
 * 错误场景测试数据
 */
export interface ErrorScenario {
  name: string
  errorMessage: string
  expectedCategory: 'transient' | 'recoverable' | 'permanent' | 'unknown'
  shouldRetry: boolean
}

/**
 * 重试策略测试场景
 */
export const retryErrorScenarios: ErrorScenario[] = [
  {
    name: '暂时性错误 - 超时',
    errorMessage: 'Request timeout after 30s',
    expectedCategory: 'transient',
    shouldRetry: true,
  },
  {
    name: '暂时性错误 - 网络重置',
    errorMessage: 'ECONNRESET: Connection reset by peer',
    expectedCategory: 'transient',
    shouldRetry: true,
  },
  {
    name: '暂时性错误 - API 限流',
    errorMessage: 'Rate limit exceeded (429)',
    expectedCategory: 'transient',
    shouldRetry: true,
  },
  {
    name: '可恢复错误 - 服务不可用',
    errorMessage: 'Service temporarily unavailable',
    expectedCategory: 'recoverable',
    shouldRetry: true,
  },
  {
    name: '永久性错误 - 认证失败',
    errorMessage: 'Authentication failed: Invalid API key',
    expectedCategory: 'permanent',
    shouldRetry: false,
  },
  {
    name: '永久性错误 - 资源不存在',
    errorMessage: 'Resource not found (404)',
    expectedCategory: 'permanent',
    shouldRetry: false,
  },
  {
    name: '未知错误',
    errorMessage: 'Something went wrong',
    expectedCategory: 'unknown',
    shouldRetry: true, // 默认重试
  },
]

/**
 * 创建模拟错误
 */
export function createMockError(scenario: ErrorScenario): Error {
  const error = new Error(scenario.errorMessage)
  error.name = 'MockError'
  return error
}

/**
 * 任务生命周期测试场景
 */
export interface LifecycleScenario {
  name: string
  initialStatus: Task['status']
  action: 'start' | 'pause' | 'resume' | 'complete' | 'fail' | 'cancel'
  expectedStatus: Task['status']
  shouldSucceed: boolean
}

export const lifecycleScenarios: LifecycleScenario[] = [
  {
    name: '启动待处理任务',
    initialStatus: 'pending',
    action: 'start',
    expectedStatus: 'running',
    shouldSucceed: true,
  },
  {
    name: '暂停运行中任务',
    initialStatus: 'running',
    action: 'pause',
    expectedStatus: 'paused',
    shouldSucceed: true,
  },
  {
    name: '恢复暂停任务',
    initialStatus: 'paused',
    action: 'resume',
    expectedStatus: 'running',
    shouldSucceed: true,
  },
  {
    name: '完成运行中任务',
    initialStatus: 'running',
    action: 'complete',
    expectedStatus: 'completed',
    shouldSucceed: true,
  },
  {
    name: '取消运行中任务',
    initialStatus: 'running',
    action: 'cancel',
    expectedStatus: 'cancelled',
    shouldSucceed: true,
  },
  {
    name: '尝试启动已完成任务（应失败）',
    initialStatus: 'completed',
    action: 'start',
    expectedStatus: 'completed',
    shouldSucceed: false,
  },
]

/**
 * 创建带状态的测试任务
 */
export function createTaskWithStatus(status: Task['status'], overrides?: Partial<Task>): Task {
  const now = new Date().toISOString()
  const id = `test-task-${Date.now()}`

  return {
    id,
    title: `测试任务 - ${status}`,
    description: `状态为 ${status} 的测试任务`,
    priority: 'medium',
    status,
    retryCount: 0,
    createdAt: now,
    ...overrides,
  }
}
