/**
 * Workflow 存储
 * 使用 SQLite 持久化工作流定义和实例
 */

import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { createLogger } from '../../shared/logger.js'
import { generateId } from '../../shared/id.js'
import type {
  Workflow,
  WorkflowInstance,
  WorkflowStatus,
  NodeState,
  NodeStatus,
  createInitialInstance,
} from '../types.js'

const logger = createLogger('workflow-store')

let db: Database.Database | null = null

function getDbPath(): string {
  const dataDir = join(process.cwd(), '.claude-agent-hub')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
  return join(dataDir, 'data.db')
}

function initDb(): Database.Database {
  if (db) return db

  db = new Database(getDbPath())

  // 创建工作流相关表
  db.exec(`
    -- 工作流定义表
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      definition TEXT NOT NULL,
      source_file TEXT,
      created_at TEXT NOT NULL
    );

    -- 工作流实例表
    CREATE TABLE IF NOT EXISTS workflow_instances (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      node_states TEXT NOT NULL DEFAULT '{}',
      variables TEXT NOT NULL DEFAULT '{}',
      outputs TEXT NOT NULL DEFAULT '{}',
      loop_counts TEXT NOT NULL DEFAULT '{}',
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_wf_instances_workflow ON workflow_instances(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_wf_instances_status ON workflow_instances(status);
  `)

  logger.debug('Workflow tables initialized')
  return db
}

// ============ Workflow CRUD ============

export function saveWorkflow(workflow: Workflow): void {
  const database = initDb()

  const stmt = database.prepare(`
    INSERT OR REPLACE INTO workflows (id, name, description, definition, source_file, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const definition = JSON.stringify({
    nodes: workflow.nodes,
    edges: workflow.edges,
    variables: workflow.variables,
  })

  stmt.run(
    workflow.id,
    workflow.name,
    workflow.description,
    definition,
    workflow.sourceFile || null,
    workflow.createdAt
  )

  logger.debug(`Saved workflow: ${workflow.id}`)
}

export function getWorkflow(id: string): Workflow | null {
  const database = initDb()

  const stmt = database.prepare('SELECT * FROM workflows WHERE id = ? OR id LIKE ?')
  const row = stmt.get(id, `${id}%`) as Record<string, unknown> | undefined

  if (!row) return null

  const definition = JSON.parse(row.definition as string)

  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    nodes: definition.nodes,
    edges: definition.edges,
    variables: definition.variables || {},
    sourceFile: row.source_file as string | undefined,
    createdAt: row.created_at as string,
  }
}

export function getAllWorkflows(): Workflow[] {
  const database = initDb()

  const stmt = database.prepare('SELECT * FROM workflows ORDER BY created_at DESC')
  const rows = stmt.all() as Record<string, unknown>[]

  return rows.map(row => {
    const definition = JSON.parse(row.definition as string)
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      nodes: definition.nodes,
      edges: definition.edges,
      variables: definition.variables || {},
      sourceFile: row.source_file as string | undefined,
      createdAt: row.created_at as string,
    }
  })
}

export function deleteWorkflow(id: string): void {
  const database = initDb()

  // 删除关联的实例
  database.prepare('DELETE FROM workflow_instances WHERE workflow_id = ?').run(id)
  // 删除工作流
  database.prepare('DELETE FROM workflows WHERE id = ?').run(id)

  logger.debug(`Deleted workflow: ${id}`)
}

// ============ Instance CRUD ============

export function createInstance(workflowId: string): WorkflowInstance {
  const workflow = getWorkflow(workflowId)
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`)
  }

  // 初始化节点状态
  const nodeStates: Record<string, NodeState> = {}
  for (const node of workflow.nodes) {
    nodeStates[node.id] = {
      status: 'pending',
      attempts: 0,
    }
  }

  const instance: WorkflowInstance = {
    id: generateId(),
    workflowId: workflow.id,  // 使用完整 ID，避免短 ID 外键约束失败
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
  const database = initDb()

  const stmt = database.prepare(`
    INSERT OR REPLACE INTO workflow_instances
    (id, workflow_id, status, node_states, variables, outputs, loop_counts, started_at, completed_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    instance.id,
    instance.workflowId,
    instance.status,
    JSON.stringify(instance.nodeStates),
    JSON.stringify(instance.variables),
    JSON.stringify(instance.outputs),
    JSON.stringify(instance.loopCounts),
    instance.startedAt || null,
    instance.completedAt || null,
    instance.error || null
  )
}

export function getInstance(id: string): WorkflowInstance | null {
  const database = initDb()

  const stmt = database.prepare('SELECT * FROM workflow_instances WHERE id = ? OR id LIKE ?')
  const row = stmt.get(id, `${id}%`) as Record<string, unknown> | undefined

  if (!row) return null

  return {
    id: row.id as string,
    workflowId: row.workflow_id as string,
    status: row.status as WorkflowStatus,
    nodeStates: JSON.parse(row.node_states as string),
    variables: JSON.parse(row.variables as string),
    outputs: JSON.parse(row.outputs as string),
    loopCounts: JSON.parse(row.loop_counts as string),
    startedAt: row.started_at as string | undefined,
    completedAt: row.completed_at as string | undefined,
    error: row.error as string | undefined,
  }
}

export function getInstancesByWorkflow(workflowId: string): WorkflowInstance[] {
  const database = initDb()

  const stmt = database.prepare(
    'SELECT * FROM workflow_instances WHERE workflow_id = ? ORDER BY started_at DESC'
  )
  const rows = stmt.all(workflowId) as Record<string, unknown>[]

  return rows.map(row => ({
    id: row.id as string,
    workflowId: row.workflow_id as string,
    status: row.status as WorkflowStatus,
    nodeStates: JSON.parse(row.node_states as string),
    variables: JSON.parse(row.variables as string),
    outputs: JSON.parse(row.outputs as string),
    loopCounts: JSON.parse(row.loop_counts as string),
    startedAt: row.started_at as string | undefined,
    completedAt: row.completed_at as string | undefined,
    error: row.error as string | undefined,
  }))
}

export function getInstancesByStatus(status: WorkflowStatus): WorkflowInstance[] {
  const database = initDb()

  const stmt = database.prepare(
    'SELECT * FROM workflow_instances WHERE status = ? ORDER BY started_at DESC'
  )
  const rows = stmt.all(status) as Record<string, unknown>[]

  return rows.map(row => ({
    id: row.id as string,
    workflowId: row.workflow_id as string,
    status: row.status as WorkflowStatus,
    nodeStates: JSON.parse(row.node_states as string),
    variables: JSON.parse(row.variables as string),
    outputs: JSON.parse(row.outputs as string),
    loopCounts: JSON.parse(row.loop_counts as string),
    startedAt: row.started_at as string | undefined,
    completedAt: row.completed_at as string | undefined,
    error: row.error as string | undefined,
  }))
}

export function getAllInstances(): WorkflowInstance[] {
  const database = initDb()

  const stmt = database.prepare('SELECT * FROM workflow_instances ORDER BY started_at DESC')
  const rows = stmt.all() as Record<string, unknown>[]

  return rows.map(row => ({
    id: row.id as string,
    workflowId: row.workflow_id as string,
    status: row.status as WorkflowStatus,
    nodeStates: JSON.parse(row.node_states as string),
    variables: JSON.parse(row.variables as string),
    outputs: JSON.parse(row.outputs as string),
    loopCounts: JSON.parse(row.loop_counts as string),
    startedAt: row.started_at as string | undefined,
    completedAt: row.completed_at as string | undefined,
    error: row.error as string | undefined,
  }))
}

// ============ Instance 状态更新 ============

export function updateInstanceStatus(id: string, status: WorkflowStatus, error?: string): void {
  const database = initDb()

  if (status === 'running') {
    database.prepare(
      'UPDATE workflow_instances SET status = ?, started_at = ? WHERE id = ?'
    ).run(status, new Date().toISOString(), id)
  } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    database.prepare(
      'UPDATE workflow_instances SET status = ?, completed_at = ?, error = ? WHERE id = ?'
    ).run(status, new Date().toISOString(), error || null, id)
  } else {
    database.prepare('UPDATE workflow_instances SET status = ? WHERE id = ?').run(status, id)
  }

  logger.debug(`Updated instance ${id} status to ${status}`)
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

  const database = initDb()
  database.prepare(
    'UPDATE workflow_instances SET node_states = ? WHERE id = ?'
  ).run(JSON.stringify(instance.nodeStates), instanceId)
}

export function setNodeOutput(instanceId: string, nodeId: string, output: unknown): void {
  const instance = getInstance(instanceId)
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`)
  }

  instance.outputs[nodeId] = output

  const database = initDb()
  database.prepare(
    'UPDATE workflow_instances SET outputs = ? WHERE id = ?'
  ).run(JSON.stringify(instance.outputs), instanceId)
}

export function incrementLoopCount(instanceId: string, edgeId: string): number {
  const instance = getInstance(instanceId)
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`)
  }

  const currentCount = instance.loopCounts[edgeId] || 0
  const newCount = currentCount + 1
  instance.loopCounts[edgeId] = newCount

  const database = initDb()
  database.prepare(
    'UPDATE workflow_instances SET loop_counts = ? WHERE id = ?'
  ).run(JSON.stringify(instance.loopCounts), instanceId)

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
