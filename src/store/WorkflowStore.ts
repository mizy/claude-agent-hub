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
import type {
  Workflow,
  WorkflowInstance,
  WorkflowStatus,
  NodeState,
} from '../workflow/types.js'

const logger = createLogger('workflow-store')

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
function forEachInstance(callback: (instance: WorkflowInstance, taskId: string) => boolean | void): void {
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
  saveTaskWorkflow(workflow.taskId, workflow)
  logger.debug(`Saved workflow: ${workflow.id} to task ${workflow.taskId}`)
}

export function getWorkflow(id: string): Workflow | null {
  // 1. 尝试直接用 id 作为 taskId 查找
  const directWorkflow = getTaskWorkflow(id)
  if (directWorkflow) return directWorkflow

  // 2. 遍历所有任务，查找匹配的 workflow.id（支持部分匹配）
  let found: Workflow | null = null
  forEachWorkflow((workflow) => {
    if (workflow.id === id || (id.length >= 6 && workflow.id.startsWith(id))) {
      found = workflow
      return true // 停止遍历
    }
    return false
  })
  return found
}

export function getAllWorkflows(): Workflow[] {
  const workflows: Workflow[] = []
  forEachWorkflow((workflow) => { workflows.push(workflow) })
  return workflows.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

export function deleteWorkflow(_id: string): void {
  // workflow 存储在 task 目录下，删除应通过 TaskStore.deleteTask
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
  const taskId = instance.variables.taskId as string | undefined
  if (!taskId) {
    logger.warn(`Instance ${instance.id} has no taskId, cannot save`)
    return
  }
  saveTaskInstance(taskId, instance)
}

export function getInstance(id: string): WorkflowInstance | null {
  let found: WorkflowInstance | null = null
  forEachInstance((instance) => {
    if (instance.id === id) {
      found = instance
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
  forEachInstance((instance) => { instances.push(instance) })
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
  const taskId = instance.variables.taskId as string | undefined

  // 状态变化时记录详细日志（用于问题追溯）
  if (status !== oldStatus) {
    const caller = new Error().stack?.split('\n').slice(2, 5).join('\n') || 'unknown'
    const logMsg =
      `Instance status change: ${id.slice(0, 8)}... [${oldStatus} → ${status}]\n` +
      `  TaskId: ${taskId || 'unknown'}\n` +
      `  WorkflowId: ${instance.workflowId.slice(0, 8)}...\n` +
      (error ? `  Error: ${error}\n` : '') +
      `  Caller:\n${caller}`
    logger.info(logMsg)

    // 同时写入任务日志文件（异步，延迟导入避免循环依赖）
    if (taskId) {
      import('./TaskLogStore.js').then(({ appendExecutionLog }) => {
        appendExecutionLog(taskId, `[INSTANCE] ${oldStatus} → ${status}\n${caller}`, {
          scope: 'lifecycle',
          level: status === 'failed' ? 'error' : 'info',
        })
      }).catch(() => {
        // 忽略日志写入失败
      })
    }
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
    throw new Error(`Instance not found: ${instanceId}`)
  }

  const nodeState = instance.nodeStates[nodeId] || { status: 'pending', attempts: 0 }
  instance.nodeStates[nodeId] = { ...nodeState, ...updates }

  saveInstance(instance)
}

export function setNodeOutput(instanceId: string, nodeId: string, output: unknown): void {
  const instance = getInstance(instanceId)
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`)
  }

  instance.outputs[nodeId] = output
  saveInstance(instance)
}

export function incrementLoopCount(instanceId: string, edgeId: string): number {
  const instance = getInstance(instanceId)
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`)
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
    // 保留 attempts 计数
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
    throw new Error(`Instance not found: ${instanceId}`)
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
