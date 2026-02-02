/**
 * 统一文件存储接口及默认实现
 *
 * UnifiedStore 定义了 Task 和 Workflow 存储操作的统一接口，
 * DefaultFileStore 代理到 TaskStore 实现。
 *
 * 注意：
 * - 泛型 FileStore 类请从 store/index.ts 或 store/GenericFileStore.ts 导入
 * - 队列操作请直接使用 workflow/queue/WorkflowQueue.js
 */

import type { Task, TaskStatus } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'
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
import { META_FILE } from './paths.js'
import { readJson, writeJson } from './readWriteJson.js'

/**
 * 统一存储接口
 * 提供 Task 和 Workflow 的存储操作方法
 *
 * 注意：队列操作请直接使用 workflow/queue/WorkflowQueue.js
 */
export interface UnifiedStore {
  // ============ Task 相关 ============
  getTask(id: string): Task | null
  getAllTasks(): Task[]
  getTasksByStatus(status: TaskStatus): Task[]
  saveTask(task: Task): void
  updateTask(id: string, updates: Partial<Task>): void
  deleteTask(id: string): void

  // ============ Workflow 相关 ============
  saveWorkflow(taskId: string, workflow: Workflow): void
  getWorkflow(taskId: string): Workflow | null
  saveInstance(taskId: string, instance: WorkflowInstance): void
  getInstance(taskId: string): WorkflowInstance | null
  appendLog(taskId: string, type: 'execution' | 'conversation', content: string | ConversationEntry): void
  saveOutput(taskId: string, nodeId: string, output: unknown): void

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

  /**
   * @deprecated 节点输出现在存储在 instance.json 的 outputs 字段中
   */
  saveOutput(taskId: string, nodeId: string, output: unknown): void {
    // nodeId 转换为 step number
    const stepNumber = parseInt(nodeId.replace(/\D/g, ''), 10) || 0
    _saveStepOutput(taskId, stepNumber, output)
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
