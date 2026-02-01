/**
 * 统一文件存储接口及默认实现
 *
 * FileStore 定义了系统所有存储操作的统一接口，
 * DefaultFileStore 代理到 TaskStore 和 WorkflowQueue 实现。
 */

import { existsSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { Task, TaskStatus } from '../types/task.js'
import type { Agent } from '../types/agent.js'
import type { Workflow, WorkflowInstance, NodeJobData } from '../workflow/types.js'
import {
  saveTask as _saveTask,
  getTask as _getTask,
  getAllTasks as _getAllTasks,
  getTasksByStatus as _getTasksByStatus,
  updateTask as _updateTask,
  deleteTask as _deleteTask,
} from './TaskStore.js'
import {
  saveTaskWorkflow,
  getTaskWorkflow,
  saveTaskInstance,
  getTaskInstance,
} from './TaskWorkflowStore.js'
import {
  appendExecutionLog as _appendExecutionLog,
  appendConversation as _appendConversation,
  saveStepOutput as _saveStepOutput,
  type ConversationEntry,
} from './TaskLogStore.js'
import {
  enqueueNode,
  getNextJob,
  getQueueStats,
} from '../workflow/queue/WorkflowQueue.js'
import { FileStore as GenericFileStore, type FileStoreOptions } from './GenericFileStore.js'
import { AGENTS_DIR, META_FILE, getAgentFilePath } from './paths.js'
import { readJson, writeJson, ensureDir } from './json.js'

// Re-export generic FileStore
export { GenericFileStore as FileStore, type FileStoreOptions }

// ============ 统一 Store 接口 ============

/**
 * 队列任务项
 */
export interface TaskQueueItem {
  id: string
  data: NodeJobData
  status: string
  priority: number
}

/**
 * 队列状态
 */
export interface QueueStatus {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

/**
 * 统一存储接口
 * 提供 Task, Agent, Workflow, Queue 的完整操作方法
 */
export interface UnifiedStore {
  // ============ Task 相关 ============
  getTask(id: string): Task | null
  getAllTasks(): Task[]
  getTasksByStatus(status: TaskStatus): Task[]
  saveTask(task: Task): void
  updateTask(id: string, updates: Partial<Task>): void
  deleteTask(id: string): void

  // ============ Agent 相关 ============
  getAgent(name: string): Agent | null
  getAllAgents(): Agent[]
  saveAgent(agent: Agent): void
  updateAgent(name: string, updates: Partial<Agent>): void
  deleteAgent(name: string): void

  // ============ Workflow 相关 ============
  saveWorkflow(taskId: string, workflow: Workflow): void
  getWorkflow(taskId: string): Workflow | null
  saveInstance(taskId: string, instance: WorkflowInstance): void
  getInstance(taskId: string): WorkflowInstance | null
  appendLog(taskId: string, type: 'execution' | 'conversation', content: string | ConversationEntry): void
  saveOutput(taskId: string, nodeId: string, output: unknown): void

  // ============ Queue 相关 ============
  enqueueTask(data: NodeJobData, options?: { delay?: number; priority?: number }): Promise<string>
  dequeueTask(instanceId?: string): TaskQueueItem | null
  getQueueStatus(): Promise<QueueStatus>

  // ============ Meta 相关 ============
  getDaemonPid(): number | null
  setDaemonPid(pid: number | null): void
}

// ============ DefaultFileStore 实现 ============

/**
 * 默认文件存储实现
 * 代理到 TaskStore 和 WorkflowQueue
 */
class DefaultFileStore implements UnifiedStore {
  // ============ Task 相关 ============

  getTask(id: string): Task | null {
    return _getTask(id)
  }

  getAllTasks(): Task[] {
    return _getAllTasks()
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return _getTasksByStatus(status)
  }

  saveTask(task: Task): void {
    _saveTask(task)
  }

  updateTask(id: string, updates: Partial<Task>): void {
    _updateTask(id, updates)
  }

  deleteTask(id: string): void {
    _deleteTask(id)
  }

  // ============ Agent 相关 ============

  getAgent(name: string): Agent | null {
    return readJson<Agent>(getAgentFilePath(name))
  }

  getAllAgents(): Agent[] {
    if (!existsSync(AGENTS_DIR)) return []

    const files = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json'))
    const agents: Agent[] = []

    for (const file of files) {
      const agent = readJson<Agent>(join(AGENTS_DIR, file))
      if (agent) {
        agents.push(agent)
      }
    }

    return agents
  }

  saveAgent(agent: Agent): void {
    ensureDir(AGENTS_DIR)
    writeJson(getAgentFilePath(agent.name), agent)
  }

  updateAgent(name: string, updates: Partial<Agent>): void {
    const agent = this.getAgent(name)
    if (!agent) return

    const updated = { ...agent, ...updates }
    this.saveAgent(updated)
  }

  deleteAgent(name: string): void {
    const filepath = getAgentFilePath(name)
    if (existsSync(filepath)) {
      unlinkSync(filepath)
    }
  }

  // ============ Workflow 相关 ============

  saveWorkflow(taskId: string, workflow: Workflow): void {
    saveTaskWorkflow(taskId, workflow)
  }

  getWorkflow(taskId: string): Workflow | null {
    return getTaskWorkflow(taskId)
  }

  saveInstance(taskId: string, instance: WorkflowInstance): void {
    saveTaskInstance(taskId, instance)
  }

  getInstance(taskId: string): WorkflowInstance | null {
    return getTaskInstance(taskId)
  }

  appendLog(taskId: string, type: 'execution' | 'conversation', content: string | ConversationEntry): void {
    if (type === 'execution' && typeof content === 'string') {
      _appendExecutionLog(taskId, content)
    } else if (type === 'conversation' && typeof content === 'object') {
      _appendConversation(taskId, content as ConversationEntry)
    }
  }

  saveOutput(taskId: string, nodeId: string, output: unknown): void {
    // nodeId 转换为 step number
    const stepNumber = parseInt(nodeId.replace(/\D/g, ''), 10) || 0
    _saveStepOutput(taskId, stepNumber, output)
  }

  // ============ Queue 相关 ============

  async enqueueTask(data: NodeJobData, options?: { delay?: number; priority?: number }): Promise<string> {
    return enqueueNode(data, options)
  }

  dequeueTask(instanceId?: string): TaskQueueItem | null {
    const job = getNextJob(instanceId)
    if (!job) return null

    return {
      id: job.id,
      data: job.data,
      status: job.status,
      priority: job.priority,
    }
  }

  async getQueueStatus(): Promise<QueueStatus> {
    return getQueueStats()
  }

  // ============ Meta 相关 ============

  getDaemonPid(): number | null {
    const meta = readJson<{ daemonPid?: number }>(META_FILE)
    return meta?.daemonPid ?? null
  }

  setDaemonPid(pid: number | null): void {
    const meta = readJson<{ daemonPid?: number }>(META_FILE) || {}
    if (pid === null) {
      delete meta.daemonPid
    } else {
      meta.daemonPid = pid
    }
    writeJson(META_FILE, meta)
  }
}

// ============ 单例 ============

let storeInstance: DefaultFileStore | null = null

/**
 * 获取统一存储实例
 */
export function getStore(): UnifiedStore {
  if (!storeInstance) {
    storeInstance = new DefaultFileStore()
  }
  return storeInstance
}
