/**
 * 测试断言辅助工具
 * 提供常见的测试验证函数
 */

import type { Task } from '../../src/types/task.js'
import type { Workflow, WorkflowInstance, WorkflowNode } from '../../src/workflow/types.js'
import type { ExecutionSummary } from '../../src/store/ExecutionStatsStore.js'

/**
 * 验证任务状态
 */
export function assertTaskStatus(task: Task, expectedStatus: Task['status']): void {
  if (task.status !== expectedStatus) {
    throw new Error(
      `Expected task status to be "${expectedStatus}", but got "${task.status}"`
    )
  }
}

/**
 * 验证任务存在
 */
export function assertTaskExists(task: Task | null, taskId: string): asserts task is Task {
  if (!task) {
    throw new Error(`Expected task "${taskId}" to exist, but it was not found`)
  }
}

/**
 * 验证 Workflow 存在
 */
export function assertWorkflowExists(
  workflow: Workflow | null,
  taskId: string
): asserts workflow is Workflow {
  if (!workflow) {
    throw new Error(`Expected workflow for task "${taskId}" to exist, but it was not found`)
  }
}

/**
 * 验证 Instance 存在
 */
export function assertInstanceExists(
  instance: WorkflowInstance | null,
  taskId: string
): asserts instance is WorkflowInstance {
  if (!instance) {
    throw new Error(`Expected instance for task "${taskId}" to exist, but it was not found`)
  }
}

/**
 * 验证节点状态
 */
export function assertNodeStatus(
  instance: WorkflowInstance,
  nodeId: string,
  expectedStatus: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
): void {
  const nodeState = instance.nodeStates[nodeId]

  if (!nodeState) {
    throw new Error(`Node "${nodeId}" not found in instance`)
  }

  if (nodeState.status !== expectedStatus) {
    throw new Error(
      `Expected node "${nodeId}" status to be "${expectedStatus}", but got "${nodeState.status}"`
    )
  }
}

/**
 * 验证所有节点都已完成
 */
export function assertAllNodesCompleted(instance: WorkflowInstance): void {
  const incompleteNodes = Object.entries(instance.nodeStates)
    .filter(([_, state]) => state.status !== 'completed' && state.status !== 'skipped')
    .map(([nodeId]) => nodeId)

  if (incompleteNodes.length > 0) {
    throw new Error(
      `Expected all nodes to be completed, but found incomplete nodes: ${incompleteNodes.join(', ')}`
    )
  }
}

/**
 * 验证节点执行顺序
 */
export function assertNodeExecutionOrder(
  instance: WorkflowInstance,
  expectedOrder: string[]
): void {
  const executedNodes = Object.entries(instance.nodeStates)
    .filter(([_, state]) => state.startedAt)
    .sort((a, b) => {
      const timeA = new Date(a[1].startedAt!).getTime()
      const timeB = new Date(b[1].startedAt!).getTime()
      return timeA - timeB
    })
    .map(([nodeId]) => nodeId)

  const orderMatches = expectedOrder.every((nodeId, index) => executedNodes[index] === nodeId)

  if (!orderMatches) {
    throw new Error(
      `Expected execution order: [${expectedOrder.join(', ')}], but got: [${executedNodes.join(', ')}]`
    )
  }
}

/**
 * 验证节点输出存在
 */
export function assertNodeOutput(
  instance: WorkflowInstance,
  nodeId: string,
  expectedKeys?: string[]
): void {
  const output = instance.outputs[nodeId]

  if (!output) {
    throw new Error(`Expected output for node "${nodeId}", but it was not found`)
  }

  if (expectedKeys) {
    const missingKeys = expectedKeys.filter(key => !(key in output))
    if (missingKeys.length > 0) {
      throw new Error(
        `Expected output keys [${expectedKeys.join(', ')}] for node "${nodeId}", but missing: [${missingKeys.join(', ')}]`
      )
    }
  }
}

/**
 * 验证重试次数
 */
export function assertRetryAttempts(
  instance: WorkflowInstance,
  nodeId: string,
  expectedAttempts: number
): void {
  const nodeState = instance.nodeStates[nodeId]

  if (!nodeState) {
    throw new Error(`Node "${nodeId}" not found in instance`)
  }

  if (nodeState.attempts !== expectedAttempts) {
    throw new Error(
      `Expected node "${nodeId}" to have ${expectedAttempts} attempts, but got ${nodeState.attempts}`
    )
  }
}

/**
 * 验证重试次数在范围内
 */
export function assertRetryAttemptsInRange(
  instance: WorkflowInstance,
  nodeId: string,
  minAttempts: number,
  maxAttempts: number
): void {
  const nodeState = instance.nodeStates[nodeId]

  if (!nodeState) {
    throw new Error(`Node "${nodeId}" not found in instance`)
  }

  if (nodeState.attempts < minAttempts || nodeState.attempts > maxAttempts) {
    throw new Error(
      `Expected node "${nodeId}" attempts to be between ${minAttempts} and ${maxAttempts}, but got ${nodeState.attempts}`
    )
  }
}

/**
 * 验证 Workflow 包含特定节点
 */
export function assertWorkflowHasNode(
  workflow: Workflow,
  nodeId: string,
  nodeType?: WorkflowNode['type']
): void {
  const node = workflow.nodes.find(n => n.id === nodeId)

  if (!node) {
    throw new Error(`Expected workflow to have node "${nodeId}", but it was not found`)
  }

  if (nodeType && node.type !== nodeType) {
    throw new Error(
      `Expected node "${nodeId}" to be of type "${nodeType}", but got "${node.type}"`
    )
  }
}

/**
 * 验证 Workflow 边的连接
 */
export function assertWorkflowEdge(
  workflow: Workflow,
  fromNodeId: string,
  toNodeId: string
): void {
  const edge = workflow.edges.find(e => e.from === fromNodeId && e.to === toNodeId)

  if (!edge) {
    throw new Error(
      `Expected workflow to have edge from "${fromNodeId}" to "${toNodeId}", but it was not found`
    )
  }
}

/**
 * 验证执行统计
 */
export function assertExecutionStats(summary: ExecutionSummary, expectations: {
  minDuration?: number
  maxDuration?: number
  minNodes?: number
  maxNodes?: number
  hasErrors?: boolean
}): void {
  if (expectations.minDuration !== undefined && summary.totalDurationMs < expectations.minDuration) {
    throw new Error(
      `Expected duration >= ${expectations.minDuration}ms, but got ${summary.totalDurationMs}ms`
    )
  }

  if (expectations.maxDuration !== undefined && summary.totalDurationMs > expectations.maxDuration) {
    throw new Error(
      `Expected duration <= ${expectations.maxDuration}ms, but got ${summary.totalDurationMs}ms`
    )
  }

  const totalNodes = summary.nodesCompleted + summary.nodesFailed

  if (expectations.minNodes !== undefined && totalNodes < expectations.minNodes) {
    throw new Error(
      `Expected at least ${expectations.minNodes} nodes, but got ${totalNodes}`
    )
  }

  if (expectations.maxNodes !== undefined && totalNodes > expectations.maxNodes) {
    throw new Error(
      `Expected at most ${expectations.maxNodes} nodes, but got ${totalNodes}`
    )
  }

  if (expectations.hasErrors !== undefined) {
    const hasErrors = summary.nodesFailed > 0
    if (hasErrors !== expectations.hasErrors) {
      throw new Error(
        `Expected hasErrors to be ${expectations.hasErrors}, but got ${hasErrors}`
      )
    }
  }
}

/**
 * 验证时间范围
 */
export function assertTimeInRange(
  timestamp: string,
  minTime: Date,
  maxTime: Date
): void {
  const time = new Date(timestamp)

  if (time < minTime || time > maxTime) {
    throw new Error(
      `Expected time "${timestamp}" to be between ${minTime.toISOString()} and ${maxTime.toISOString()}`
    )
  }
}

/**
 * 验证数组唯一性
 */
export function assertArrayUnique<T>(array: T[], itemName: string = 'item'): void {
  const uniqueItems = new Set(array)

  if (uniqueItems.size !== array.length) {
    throw new Error(
      `Expected all ${itemName}s to be unique, but found duplicates. Got ${array.length} items, but only ${uniqueItems.size} unique`
    )
  }
}

/**
 * 验证数组非空
 */
export function assertArrayNotEmpty<T>(array: T[], arrayName: string = 'array'): void {
  if (array.length === 0) {
    throw new Error(`Expected ${arrayName} to not be empty`)
  }
}

/**
 * 验证对象包含键
 */
export function assertObjectHasKeys(
  obj: Record<string, unknown>,
  keys: string[],
  objectName: string = 'object'
): void {
  const missingKeys = keys.filter(key => !(key in obj))

  if (missingKeys.length > 0) {
    throw new Error(
      `Expected ${objectName} to have keys [${keys.join(', ')}], but missing: [${missingKeys.join(', ')}]`
    )
  }
}

/**
 * 验证错误消息匹配
 */
export function assertErrorMatches(
  error: unknown,
  expectedPattern: string | RegExp
): void {
  const message = error instanceof Error ? error.message : String(error)

  const matches = typeof expectedPattern === 'string'
    ? message.includes(expectedPattern)
    : expectedPattern.test(message)

  if (!matches) {
    throw new Error(
      `Expected error message to match "${expectedPattern}", but got: "${message}"`
    )
  }
}

/**
 * 验证性能指标
 */
export function assertPerformance(
  actualMs: number,
  expectedMs: number,
  tolerance: number = 0.2
): void {
  const minMs = expectedMs * (1 - tolerance)
  const maxMs = expectedMs * (1 + tolerance)

  if (actualMs < minMs || actualMs > maxMs) {
    throw new Error(
      `Expected duration to be between ${minMs}ms and ${maxMs}ms (±${tolerance * 100}%), but got ${actualMs}ms`
    )
  }
}
