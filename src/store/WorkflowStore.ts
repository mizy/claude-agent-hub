/**
 * Workflow 存储 - 薄包装层
 *
 * 所有存储操作都代理到 TaskWorkflowStore，Workflow 数据存储在任务目录下：
 * data/tasks/{taskId}/
 * ├── workflow.json
 * └── instance.json
 *
 * 提供基于 workflowId/instanceId 的查找接口。
 */

import { createLogger } from '../shared/logger.js'
import { generateId } from '../shared/generateId.js'
import { getAllTaskSummaries } from './TaskStore.js'
import {
  getTaskWorkflow,
  saveTaskWorkflow,
  getTaskInstance,
  saveTaskInstance,
} from './TaskWorkflowStore.js'
import type { Workflow, WorkflowInstance, WorkflowStatus, NodeState } from '../types/workflow.js'

const logger = createLogger('workflow-store')

/** Safely extract taskId from instance variables */
function getInstanceTaskId(instance: WorkflowInstance): string | undefined {
  const taskId = instance.variables.taskId
  return typeof taskId === 'string' ? taskId : undefined
}

// instanceId → taskId 缓存，避免 getInstance 全量扫描
const instanceTaskIdCache = new Map<string, string>()

// workflowId → taskId 缓存，避免 getWorkflow 全量扫描
const workflowIdToTaskIdCache = new Map<string, string>()

// ============ 内部辅助函数 ============

/** 遍历所有任务的 workflow */
function forEachWorkflow(callback: (workflow: Workflow, taskId: string) => boolean | void): void {
  const summaries = getAllTaskSummaries()
  for (const summary of summaries) {
    const workflow = getTaskWorkflow(summary.id)
    if (workflow && callback(workflow, summary.id) === true) {
      break
    }
  }
}

/** 遍历所有任务的 instance */
function forEachInstance(
  callback: (instance: WorkflowInstance, taskId: string) => boolean | void
): void {
  const summaries = getAllTaskSummaries()
  for (const summary of summaries) {
    const instance = getTaskInstance(summary.id)
    if (instance && callback(instance, summary.id) === true) {
      break
    }
  }
}

// ============ Workflow CRUD ============

export function saveWorkflow(workflow: Workflow): void {
  if (!workflow.taskId) {
    logger.warn(`Workflow ${workflow.id} has no taskId, cannot save`)
    return
  }
  workflowIdToTaskIdCache.set(workflow.id, workflow.taskId)
  saveTaskWorkflow(workflow.taskId, workflow)
  logger.debug(`Saved workflow: ${workflow.id} to task ${workflow.taskId}`)
}

export function getWorkflow(id: string): Workflow | null {
  // 1. 尝试直接用 id 作为 taskId 查找
  const directWorkflow = getTaskWorkflow(id)
  if (directWorkflow) return directWorkflow

  // 2. 快速路径：通过缓存直接定位 task 目录
  const cachedTaskId = workflowIdToTaskIdCache.get(id)
  if (cachedTaskId) {
    const workflow = getTaskWorkflow(cachedTaskId)
    if (workflow && workflow.id === id) return workflow
  }

  // 3. 慢路径：遍历所有任务，查找匹配的 workflow.id（支持部分匹配）
  let found: Workflow | null = null
  forEachWorkflow((workflow, taskId) => {
    if (workflow.id === id || (id.length >= 6 && workflow.id.startsWith(id))) {
      found = workflow
      // 回填缓存（仅精确匹配）
      if (workflow.id === id) {
        workflowIdToTaskIdCache.set(id, taskId)
      }
      return true // 停止遍历
    }
    return false
  })
  return found
}

export function getAllWorkflows(): Workflow[] {
  const workflows: Workflow[] = []
  forEachWorkflow(workflow => {
    workflows.push(workflow)
  })
  return workflows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function deleteWorkflow(id: string): void {
  // workflow 存储在 task 目录下，删除应通过 TaskStore.deleteTask
  workflowIdToTaskIdCache.delete(id)
  logger.debug(`Delete workflow - use TaskStore.deleteTask instead`)
}

// ============ Instance CRUD ============

export function createInstance(workflowId: string): WorkflowInstance {
  const workflow = getWorkflow(workflowId)
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`)
  }

  const nodeStates: Record<string, NodeState> = {}
  for (const node of workflow.nodes) {
    nodeStates[node.id] = { status: 'pending', attempts: 0 }
  }

  const instance: WorkflowInstance = {
    id: generateId(),
    workflowId: workflow.id,
    status: 'pending',
    nodeStates,
    variables: { ...workflow.variables, taskId: workflow.taskId },
    outputs: {},
    loopCounts: {},
  }

  saveInstance(instance)
  logger.info(`Created instance: ${instance.id} for workflow: ${workflowId}`)
  return instance
}

export function saveInstance(instance: WorkflowInstance): void {
  const taskId = getInstanceTaskId(instance)
  if (!taskId) {
    logger.warn(`Instance ${instance.id} has no taskId, cannot save`)
    return
  }
  // 更新缓存
  instanceTaskIdCache.set(instance.id, taskId)
  saveTaskInstance(taskId, instance)
}

export function getInstance(id: string): WorkflowInstance | null {
  // 快速路径：通过缓存直接定位 task 目录
  const cachedTaskId = instanceTaskIdCache.get(id)
  if (cachedTaskId) {
    const instance = getTaskInstance(cachedTaskId)
    if (instance && instance.id === id) return instance
  }

  // 慢路径：全量扫描（仅在缓存未命中时）
  let found: WorkflowInstance | null = null
  forEachInstance(instance => {
    if (instance.id === id) {
      found = instance
      // 回填缓存
      const taskId = getInstanceTaskId(instance)
      if (taskId) instanceTaskIdCache.set(id, taskId)
      return true
    }
    return false
  })
  return found
}

export function getInstancesByWorkflow(workflowId: string): WorkflowInstance[] {
  return getAllInstances().filter(i => i.workflowId === workflowId)
}

export function getInstancesByStatus(status: WorkflowStatus): WorkflowInstance[] {
  return getAllInstances().filter(i => i.status === status)
}

export function getAllInstances(): WorkflowInstance[] {
  const instances: WorkflowInstance[] = []
  forEachInstance(instance => {
    instances.push(instance)
  })
  return instances.sort((a, b) => {
    const aTime = a.startedAt || a.id
    const bTime = b.startedAt || b.id
    return bTime.localeCompare(aTime)
  })
}

// ============ Instance 状态更新 ============

export function updateInstanceStatus(id: string, status: WorkflowStatus, error?: string): void {
  const instance = getInstance(id)
  if (!instance) return

  const oldStatus = instance.status

  // 状态变化时记录日志
  if (status !== oldStatus) {
    const brief = error ? ` (${error.slice(0, 80)})` : ''
    logger.info(`[INSTANCE] ${id.slice(0, 8)} ${oldStatus} → ${status}${brief}`)
  }

  instance.status = status

  if (status === 'running' && !instance.startedAt) {
    instance.startedAt = new Date().toISOString()
  } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    instance.completedAt = new Date().toISOString()
    if (error) instance.error = error
  }

  saveInstance(instance)
}

export function updateNodeState(
  instanceId: string,
  nodeId: string,
  updates: Partial<NodeState>
): void {
  const instance = getInstance(instanceId)
  if (!instance) {
    logger.warn(`updateNodeState: instance not found: ${instanceId}, skipping`)
    return
  }

  const nodeState = instance.nodeStates[nodeId] || { status: 'pending', attempts: 0 }
  instance.nodeStates[nodeId] = { ...nodeState, ...updates }

  saveInstance(instance)
}

export function setNodeOutput(instanceId: string, nodeId: string, output: unknown): void {
  const instance = getInstance(instanceId)
  if (!instance) {
    logger.warn(`setNodeOutput: instance not found: ${instanceId}, skipping`)
    return
  }

  instance.outputs[nodeId] = output
  saveInstance(instance)
}

export function incrementLoopCount(instanceId: string, edgeId: string): number {
  const instance = getInstance(instanceId)
  if (!instance) {
    logger.warn(`incrementLoopCount: instance not found: ${instanceId}, skipping`)
    return 0
  }

  const currentCount = instance.loopCounts[edgeId] || 0
  const newCount = currentCount + 1
  instance.loopCounts[edgeId] = newCount

  saveInstance(instance)

  return newCount
}

export function resetNodeState(instanceId: string, nodeId: string): void {
  updateNodeState(instanceId, nodeId, {
    status: 'pending',
    startedAt: undefined,
    completedAt: undefined,
    error: undefined,
    attempts: 0, // Reset attempts — loop reentry is not a retry
  })
}

/**
 * 更新实例变量
 */
export function updateInstanceVariables(
  instanceId: string,
  updates: Record<string, unknown>
): void {
  const instance = getInstance(instanceId)
  if (!instance) {
    logger.warn(`updateInstanceVariables: instance not found: ${instanceId}, skipping`)
    return
  }

  // 合并更新
  for (const [key, value] of Object.entries(updates)) {
    // 支持点号表示嵌套，如 "user.name"
    if (key.includes('.')) {
      setNestedValue(instance.variables, key, value)
    } else {
      instance.variables[key] = value
    }
  }

  saveInstance(instance)
  logger.debug(`Updated variables for instance ${instanceId}: ${Object.keys(updates).join(', ')}`)
}

/**
 * 设置嵌套值
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }

  const lastPart = parts[parts.length - 1]!
  current[lastPart] = value
}
