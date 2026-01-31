/**
 * Workflow 文件存储
 *
 * Workflow 保存在关联的 task 目录下：
 * data/tasks/{taskId}/
 * ├── workflow.json
 * └── instance.json
 *
 * 向后兼容：也支持从旧的 data/workflows/ 目录读取
 */

import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../../shared/logger.js'
import { generateId } from '../../shared/id.js'
import type {
  Workflow,
  WorkflowInstance,
  WorkflowStatus,
  NodeState,
} from '../types.js'

const logger = createLogger('workflow-store')

// Data directories
const DATA_DIR = join(process.cwd(), 'data')
const TASKS_DIR = join(DATA_DIR, 'tasks')
// Legacy directories (for backward compatibility)
const WORKFLOWS_DIR = join(DATA_DIR, 'workflows')
const DEFINITIONS_DIR = join(WORKFLOWS_DIR, 'definitions')

// Workflow ID -> TaskId 映射缓存
const workflowToTaskCache: Map<string, string> = new Map()

// Ensure directories exist
function ensureDirs(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true })
}

// Read JSON file
function readJson<T>(filepath: string): T | null {
  try {
    const content = readFileSync(filepath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

// Write JSON file
function writeJson(filepath: string, data: unknown): void {
  const dir = join(filepath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8')
}

// Instance ID -> TaskId 映射缓存
const instanceToTaskCache: Map<string, string> = new Map()

// 查找 instance 文件
function findInstanceFile(id: string): string | null {
  // 1. 检查缓存
  const cachedTaskId = instanceToTaskCache.get(id)
  if (cachedTaskId) {
    const filepath = join(TASKS_DIR, cachedTaskId, 'instance.json')
    if (existsSync(filepath)) {
      return filepath
    }
  }

  // 2. 搜索所有 task 目录
  if (existsSync(TASKS_DIR)) {
    const taskFolders = readdirSync(TASKS_DIR)
    for (const taskId of taskFolders) {
      const filepath = join(TASKS_DIR, taskId, 'instance.json')
      if (existsSync(filepath)) {
        const instance = readJson<WorkflowInstance>(filepath)
        if (instance?.id === id) {
          instanceToTaskCache.set(id, taskId)
          return filepath
        }
      }
    }
  }

  return null
}

// Initialize on first use
let initialized = false
function init(): void {
  if (!initialized) {
    ensureDirs()
    initialized = true
  }
}

// ============ Workflow CRUD ============

export function saveWorkflow(workflow: Workflow): void {
  init()

  // 如果有 taskId，保存到 task 目录
  if (workflow.taskId) {
    const taskDir = join(TASKS_DIR, workflow.taskId)
    if (!existsSync(taskDir)) {
      mkdirSync(taskDir, { recursive: true })
    }
    const filepath = join(taskDir, 'workflow.json')
    writeJson(filepath, workflow)
    // 更新缓存
    workflowToTaskCache.set(workflow.id, workflow.taskId)
    logger.debug(`Saved workflow: ${workflow.id} to task ${workflow.taskId}`)
    return
  }

  // 向后兼容：没有 taskId 时保存到旧目录
  if (!existsSync(DEFINITIONS_DIR)) {
    mkdirSync(DEFINITIONS_DIR, { recursive: true })
  }
  const filepath = join(DEFINITIONS_DIR, `${workflow.id}.json`)
  writeJson(filepath, workflow)
  logger.debug(`Saved workflow: ${workflow.id}`)
}

export function getWorkflow(id: string): Workflow | null {
  init()

  // 1. 检查缓存
  const cachedTaskId = workflowToTaskCache.get(id)
  if (cachedTaskId) {
    const taskDir = join(TASKS_DIR, cachedTaskId)
    const filepath = join(taskDir, 'workflow.json')
    if (existsSync(filepath)) {
      return readJson<Workflow>(filepath)
    }
  }

  // 2. 搜索所有 task 目录
  if (existsSync(TASKS_DIR)) {
    const taskFolders = readdirSync(TASKS_DIR)
    for (const taskId of taskFolders) {
      const filepath = join(TASKS_DIR, taskId, 'workflow.json')
      if (existsSync(filepath)) {
        const workflow = readJson<Workflow>(filepath)
        if (workflow?.id === id) {
          workflowToTaskCache.set(id, taskId)
          return workflow
        }
      }
    }
  }

  // 3. 向后兼容：从旧目录查找
  if (existsSync(DEFINITIONS_DIR)) {
    const filepath = join(DEFINITIONS_DIR, `${id}.json`)
    if (existsSync(filepath)) {
      return readJson<Workflow>(filepath)
    }

    // Partial match
    const files = readdirSync(DEFINITIONS_DIR)
    for (const file of files) {
      if (file.startsWith(id) && file.endsWith('.json')) {
        return readJson<Workflow>(join(DEFINITIONS_DIR, file))
      }
    }
  }

  return null
}

export function getAllWorkflows(): Workflow[] {
  init()
  const workflows: Workflow[] = []

  // 从 task 目录收集
  if (existsSync(TASKS_DIR)) {
    const taskFolders = readdirSync(TASKS_DIR)
    for (const taskId of taskFolders) {
      const filepath = join(TASKS_DIR, taskId, 'workflow.json')
      if (existsSync(filepath)) {
        const workflow = readJson<Workflow>(filepath)
        if (workflow) {
          workflows.push(workflow)
          workflowToTaskCache.set(workflow.id, taskId)
        }
      }
    }
  }

  // 向后兼容：从旧目录收集
  if (existsSync(DEFINITIONS_DIR)) {
    const files = readdirSync(DEFINITIONS_DIR).filter(f => f.endsWith('.json'))
    for (const file of files) {
      const workflow = readJson<Workflow>(join(DEFINITIONS_DIR, file))
      if (workflow && !workflows.find(w => w.id === workflow.id)) {
        workflows.push(workflow)
      }
    }
  }

  return workflows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function deleteWorkflow(id: string): void {
  init()

  // 从 task 目录删除
  const cachedTaskId = workflowToTaskCache.get(id)
  if (cachedTaskId) {
    const filepath = join(TASKS_DIR, cachedTaskId, 'workflow.json')
    if (existsSync(filepath)) {
      rmSync(filepath)
      workflowToTaskCache.delete(id)
    }
  }

  // 从旧目录删除
  const defPath = join(DEFINITIONS_DIR, `${id}.json`)
  if (existsSync(defPath)) {
    rmSync(defPath)
  }

  logger.debug(`Deleted workflow: ${id}`)
}

// ============ Instance CRUD ============

export function createInstance(workflowId: string): WorkflowInstance {
  init()
  const workflow = getWorkflow(workflowId)
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`)
  }

  // Initialize node states
  const nodeStates: Record<string, NodeState> = {}
  for (const node of workflow.nodes) {
    nodeStates[node.id] = {
      status: 'pending',
      attempts: 0,
    }
  }

  const instance: WorkflowInstance = {
    id: generateId(),
    workflowId: workflow.id,
    status: 'pending',
    nodeStates,
    variables: {
      ...workflow.variables,
      taskId: workflow.taskId, // 保存 taskId 供后续使用
    },
    outputs: {},
    loopCounts: {},
  }

  // 保存到 task 目录
  if (workflow.taskId) {
    instanceToTaskCache.set(instance.id, workflow.taskId)
  }

  saveInstance(instance)
  logger.info(`Created instance: ${instance.id} for workflow: ${workflowId}`)

  return instance
}

export function saveInstance(instance: WorkflowInstance): void {
  init()

  // 从 variables 获取 taskId
  const taskId = instance.variables.taskId as string | undefined

  if (taskId) {
    const taskDir = join(TASKS_DIR, taskId)
    if (!existsSync(taskDir)) {
      mkdirSync(taskDir, { recursive: true })
    }
    const filepath = join(taskDir, 'instance.json')
    writeJson(filepath, instance)
    instanceToTaskCache.set(instance.id, taskId)
    return
  }

  // 向后兼容：如果没有 taskId，尝试从缓存查找
  const cachedTaskId = instanceToTaskCache.get(instance.id)
  if (cachedTaskId) {
    const filepath = join(TASKS_DIR, cachedTaskId, 'instance.json')
    writeJson(filepath, instance)
    return
  }

  // 最后：搜索已有的 instance 文件并更新
  const existingPath = findInstanceFile(instance.id)
  if (existingPath) {
    writeJson(existingPath, instance)
    return
  }

  logger.warn(`No task directory found for instance ${instance.id}, skipping save`)
}

export function getInstance(id: string): WorkflowInstance | null {
  init()
  const filepath = findInstanceFile(id)
  if (!filepath) return null
  return readJson<WorkflowInstance>(filepath)
}

export function getInstancesByWorkflow(workflowId: string): WorkflowInstance[] {
  init()
  return getAllInstances().filter(i => i.workflowId === workflowId)
}

export function getInstancesByStatus(status: WorkflowStatus): WorkflowInstance[] {
  init()
  return getAllInstances().filter(i => i.status === status)
}

export function getAllInstances(): WorkflowInstance[] {
  init()
  const instances: WorkflowInstance[] = []

  // 从所有 task 目录收集
  if (existsSync(TASKS_DIR)) {
    const taskFolders = readdirSync(TASKS_DIR)
    for (const taskId of taskFolders) {
      const filepath = join(TASKS_DIR, taskId, 'instance.json')
      if (existsSync(filepath)) {
        const instance = readJson<WorkflowInstance>(filepath)
        if (instance) {
          instances.push(instance)
          instanceToTaskCache.set(instance.id, taskId)
        }
      }
    }
  }

  return instances.sort((a, b) => {
    const aTime = a.startedAt || a.id
    const bTime = b.startedAt || b.id
    return bTime.localeCompare(aTime)
  })
}

// ============ Instance 状态更新 ============

export function updateInstanceStatus(id: string, status: WorkflowStatus, error?: string): void {
  init()
  const instance = getInstance(id)
  if (!instance) return

  instance.status = status

  if (status === 'running' && !instance.startedAt) {
    instance.startedAt = new Date().toISOString()
  } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    instance.completedAt = new Date().toISOString()
    if (error) instance.error = error
  }

  saveInstance(instance)
  logger.debug(`Updated instance ${id} status to ${status}`)
}

export function updateNodeState(
  instanceId: string,
  nodeId: string,
  updates: Partial<NodeState>
): void {
  init()
  const instance = getInstance(instanceId)
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`)
  }

  const nodeState = instance.nodeStates[nodeId] || { status: 'pending', attempts: 0 }
  instance.nodeStates[nodeId] = { ...nodeState, ...updates }

  saveInstance(instance)
}

export function setNodeOutput(instanceId: string, nodeId: string, output: unknown): void {
  init()
  const instance = getInstance(instanceId)
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`)
  }

  instance.outputs[nodeId] = output
  saveInstance(instance)
}

export function incrementLoopCount(instanceId: string, edgeId: string): number {
  init()
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
    result: undefined,
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
  init()
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
