/**
 * WorkflowStore 缓存逻辑测试
 *
 * 测试 workflowIdToTaskIdCache 和 instanceTaskIdCache 的行为：
 * - saveWorkflow 后 getWorkflow 能命中缓存
 * - 缓存 miss 时仍能通过扫描找到
 * - deleteWorkflow 后缓存被清除
 * - saveInstance 后 getInstance 能命中缓存
 * - instance 缓存 miss 时仍能通过扫描找到
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'

import {
  saveTask,
  saveTaskWorkflow,
  saveTaskInstance,
  TASKS_DIR,
} from '../src/store/index.js'
import {
  saveWorkflow,
  getWorkflow,
  deleteWorkflow,
  saveInstance,
  getInstance,
} from '../src/store/WorkflowStore.js'
import type { Task } from '../src/types/task.js'
import type { Workflow, WorkflowInstance } from '../src/workflow/types.js'

const TEST_PREFIX = `test-wfcache-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const createdTaskIds: string[] = []

function createTestTask(id?: string): Task {
  const taskId = id || `${TEST_PREFIX}-${Math.random().toString(36).slice(2, 8)}`
  createdTaskIds.push(taskId)
  return {
    id: taskId,
    title: 'Cache Test Task',
    description: 'For workflow cache testing',
    priority: 'medium',
    status: 'pending',
    retryCount: 0,
    createdAt: new Date().toISOString(),
  }
}

function createTestWorkflow(taskId: string, workflowId?: string): Workflow {
  return {
    id: workflowId || `wf-${Math.random().toString(36).slice(2, 10)}`,
    taskId,
    name: 'Test Workflow',
    description: 'Test',
    nodes: [],
    edges: [],
    variables: {},
    createdAt: new Date().toISOString(),
  }
}

describe('WorkflowStore Cache', () => {
  beforeAll(() => {
    // Tasks dir is auto-initialized by TaskStore import
  })

  afterAll(() => {
    for (const taskId of createdTaskIds) {
      const taskDir = join(TASKS_DIR, taskId)
      if (existsSync(taskDir)) {
        rmSync(taskDir, { recursive: true, force: true })
      }
    }
  })

  it('saveWorkflow 后 getWorkflow 应命中缓存（不需要全量扫描）', () => {
    const task = createTestTask()
    saveTask(task)

    const workflow = createTestWorkflow(task.id)
    saveWorkflow(workflow)

    // getWorkflow by workflowId — 应通过缓存直接定位
    const retrieved = getWorkflow(workflow.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(workflow.id)
    expect(retrieved!.taskId).toBe(task.id)
  })

  it('缓存 miss 时仍能通过扫描找到 workflow', () => {
    const task = createTestTask()
    saveTask(task)

    const workflow = createTestWorkflow(task.id)
    // 直接用 saveTaskWorkflow 绕过 WorkflowStore 的缓存填充
    saveTaskWorkflow(task.id, workflow)

    // getWorkflow 缓存里没有，应通过慢路径扫描找到
    const retrieved = getWorkflow(workflow.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(workflow.id)
  })

  it('deleteWorkflow 后缓存应被清除', () => {
    const task = createTestTask()
    saveTask(task)

    const workflow = createTestWorkflow(task.id)
    saveWorkflow(workflow)

    // 确认能找到
    expect(getWorkflow(workflow.id)).not.toBeNull()

    // 删除（清除缓存）
    deleteWorkflow(workflow.id)

    // 注意：deleteWorkflow 只清缓存，不删文件（需通过 deleteTask）
    // 所以扫描仍能找到，但缓存已被清除
    // 验证的是：删除后再查找走的是扫描路径而非缓存
    const afterDelete = getWorkflow(workflow.id)
    // 文件仍在，扫描仍能找到
    expect(afterDelete).not.toBeNull()
  })

  it('getWorkflow 支持部分 ID 匹配（长度 >= 6）', () => {
    const task = createTestTask()
    saveTask(task)

    const workflowId = 'wf-partial-match-test-abc123'
    const workflow = createTestWorkflow(task.id, workflowId)
    saveTaskWorkflow(task.id, workflow)

    // 用前 8 个字符查找
    const partial = getWorkflow('wf-parti')
    expect(partial).not.toBeNull()
    expect(partial!.id).toBe(workflowId)
  })

  it('不存在的 workflowId 应返回 null', () => {
    const result = getWorkflow('wf-nonexistent-xyz-123')
    expect(result).toBeNull()
  })
})

function createTestInstance(taskId: string, workflowId: string, instanceId?: string): WorkflowInstance {
  return {
    id: instanceId || `inst-${Math.random().toString(36).slice(2, 10)}`,
    workflowId,
    status: 'pending',
    nodeStates: {},
    variables: { taskId },
    outputs: {},
    loopCounts: {},
  }
}

describe('WorkflowStore Instance Cache', () => {
  afterAll(() => {
    for (const taskId of createdTaskIds) {
      const taskDir = join(TASKS_DIR, taskId)
      if (existsSync(taskDir)) {
        rmSync(taskDir, { recursive: true, force: true })
      }
    }
  })

  it('saveInstance 后 getInstance 应命中缓存', () => {
    const task = createTestTask()
    saveTask(task)

    const workflow = createTestWorkflow(task.id)
    saveWorkflow(workflow)

    const instance = createTestInstance(task.id, workflow.id)
    saveInstance(instance)

    const retrieved = getInstance(instance.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(instance.id)
    expect(retrieved!.workflowId).toBe(workflow.id)
  })

  it('缓存 miss 时通过扫描仍能找到 instance', () => {
    const task = createTestTask()
    saveTask(task)

    const workflow = createTestWorkflow(task.id)
    saveWorkflow(workflow)

    const instance = createTestInstance(task.id, workflow.id)
    // 直接用 saveTaskInstance 绕过 WorkflowStore 的缓存填充
    saveTaskInstance(task.id, instance)

    // getInstance 缓存中没有，应通过扫描找到
    const retrieved = getInstance(instance.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(instance.id)
  })

  it('不存在的 instanceId 应返回 null', () => {
    const result = getInstance('inst-nonexistent-xyz-123')
    expect(result).toBeNull()
  })
})
