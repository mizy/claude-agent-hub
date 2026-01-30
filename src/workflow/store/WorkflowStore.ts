/**
 * Workflow 文件存储
 *
 * Structure:
 * data/workflows/
 * ├── definitions/
 * │   └── {id}.json
 * └── instances/
 *     ├── pending/
 *     ├── running/
 *     ├── completed/
 *     ├── failed/
 *     └── cancelled/
 *         └── {id}.json
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
const WORKFLOWS_DIR = join(DATA_DIR, 'workflows')
const DEFINITIONS_DIR = join(WORKFLOWS_DIR, 'definitions')
const INSTANCES_DIR = join(WORKFLOWS_DIR, 'instances')

const INSTANCE_STATUS_DIRS: WorkflowStatus[] = ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled']

// Ensure directories exist
function ensureDirs(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(WORKFLOWS_DIR)) mkdirSync(WORKFLOWS_DIR, { recursive: true })
  if (!existsSync(DEFINITIONS_DIR)) mkdirSync(DEFINITIONS_DIR, { recursive: true })
  if (!existsSync(INSTANCES_DIR)) mkdirSync(INSTANCES_DIR, { recursive: true })

  for (const status of INSTANCE_STATUS_DIRS) {
    const dir = join(INSTANCES_DIR, status)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
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

// Find instance file across status directories
function findInstanceFile(id: string): { filepath: string; status: WorkflowStatus } | null {
  for (const status of INSTANCE_STATUS_DIRS) {
    const dir = join(INSTANCES_DIR, status)
    if (!existsSync(dir)) continue

    const filepath = join(dir, `${id}.json`)
    if (existsSync(filepath)) {
      return { filepath, status }
    }

    // Try partial match
    const files = readdirSync(dir)
    for (const file of files) {
      if (file.startsWith(id) && file.endsWith('.json')) {
        return { filepath: join(dir, file), status }
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
  const filepath = join(DEFINITIONS_DIR, `${workflow.id}.json`)
  writeJson(filepath, workflow)
  logger.debug(`Saved workflow: ${workflow.id}`)
}

export function getWorkflow(id: string): Workflow | null {
  init()

  // Direct lookup
  const filepath = join(DEFINITIONS_DIR, `${id}.json`)
  if (existsSync(filepath)) {
    return readJson<Workflow>(filepath)
  }

  // Partial match
  if (!existsSync(DEFINITIONS_DIR)) return null
  const files = readdirSync(DEFINITIONS_DIR)
  for (const file of files) {
    if (file.startsWith(id) && file.endsWith('.json')) {
      return readJson<Workflow>(join(DEFINITIONS_DIR, file))
    }
  }

  return null
}

export function getAllWorkflows(): Workflow[] {
  init()
  if (!existsSync(DEFINITIONS_DIR)) return []

  const files = readdirSync(DEFINITIONS_DIR).filter(f => f.endsWith('.json'))
  return files
    .map(f => readJson<Workflow>(join(DEFINITIONS_DIR, f)))
    .filter((w): w is Workflow => w !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function deleteWorkflow(id: string): void {
  init()

  // Delete definition
  const defPath = join(DEFINITIONS_DIR, `${id}.json`)
  if (existsSync(defPath)) {
    rmSync(defPath)
  }

  // Delete all instances of this workflow
  for (const status of INSTANCE_STATUS_DIRS) {
    const dir = join(INSTANCES_DIR, status)
    if (!existsSync(dir)) continue

    const files = readdirSync(dir)
    for (const file of files) {
      const instance = readJson<WorkflowInstance>(join(dir, file))
      if (instance?.workflowId === id) {
        rmSync(join(dir, file))
      }
    }
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
    variables: { ...workflow.variables },
    outputs: {},
    loopCounts: {},
  }

  saveInstance(instance)
  logger.info(`Created instance: ${instance.id} for workflow: ${workflowId}`)

  return instance
}

export function saveInstance(instance: WorkflowInstance): void {
  init()

  // Find and remove old file if status changed
  const existing = findInstanceFile(instance.id)
  if (existing && existing.status !== instance.status) {
    try { rmSync(existing.filepath) } catch { /* ignore */ }
  }

  const filepath = join(INSTANCES_DIR, instance.status, `${instance.id}.json`)
  writeJson(filepath, instance)
}

export function getInstance(id: string): WorkflowInstance | null {
  init()
  const found = findInstanceFile(id)
  if (!found) return null
  return readJson<WorkflowInstance>(found.filepath)
}

export function getInstancesByWorkflow(workflowId: string): WorkflowInstance[] {
  init()
  return getAllInstances().filter(i => i.workflowId === workflowId)
}

export function getInstancesByStatus(status: WorkflowStatus): WorkflowInstance[] {
  init()
  const dir = join(INSTANCES_DIR, status)
  if (!existsSync(dir)) return []

  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  return files
    .map(f => readJson<WorkflowInstance>(join(dir, f)))
    .filter((i): i is WorkflowInstance => i !== null)
    .sort((a, b) => {
      const aTime = a.startedAt || a.id
      const bTime = b.startedAt || b.id
      return bTime.localeCompare(aTime)
    })
}

export function getAllInstances(): WorkflowInstance[] {
  init()
  const instances: WorkflowInstance[] = []

  for (const status of INSTANCE_STATUS_DIRS) {
    instances.push(...getInstancesByStatus(status))
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
