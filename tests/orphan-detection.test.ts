/**
 * Orphan Detection 测试
 *
 * 验证 detectOrphanedTasks 的判断逻辑：
 * - 无 process.json 且无 workflow → 不视为 orphan（从未执行）
 * - 有 workflow 无 process.json 且 status 为 planning/developing → 视为 orphan
 * - 有 process.json 且进程已死 → 视为 orphan
 * - 有 process.json 且进程存活 → 不视为 orphan
 * - 进程状态为 stopped → 不视为 orphan
 * - 新创建任务（宽限期内）→ 不视为 orphan
 * - pending 状态不参与检测
 */

import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'

import {
  saveTask,
  saveProcessInfo,
  TASKS_DIR,
  type ProcessInfo,
} from '../src/store/index.js'
import { writeJson } from '../src/store/readWriteJson.js'
import { saveTaskWorkflow } from '../src/store/TaskWorkflowStore.js'
import { detectOrphanedTasks } from '../src/task/resumeTask.js'
import type { Task } from '../src/types/task.js'
import type { Workflow } from '../src/workflow/types.js'

const TEST_PREFIX = `test-orphan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const createdTaskIds: string[] = []

// 创建足够老的时间戳（超过 30s 宽限期）
const OLD_TIME = new Date(Date.now() - 120_000).toISOString()

function createTestTask(overrides: Partial<Task> = {}): Task {
  const taskId = overrides.id || `${TEST_PREFIX}-${Math.random().toString(36).slice(2, 8)}`
  createdTaskIds.push(taskId)
  return {
    id: taskId,
    title: 'Orphan Test Task',
    description: 'For orphan detection testing',
    priority: 'medium',
    status: 'planning',
    retryCount: 0,
    createdAt: OLD_TIME,
    updatedAt: OLD_TIME,
    ...overrides,
  }
}

/**
 * saveTask 会强制把 updatedAt 设为 now()，导致任务始终在宽限期内。
 * 这个函数在 saveTask 后覆写 task.json，把时间戳改为过去。
 */
function saveTaskBypassingGrace(task: Task): void {
  saveTask(task)
  const taskJson = { ...task, updatedAt: OLD_TIME, createdAt: task.createdAt }
  writeJson(join(TASKS_DIR, task.id, 'task.json'), taskJson)
}

function createTestWorkflow(taskId: string): Workflow {
  return {
    id: `wf-${taskId}`,
    taskId,
    name: 'Test Workflow',
    description: 'Test',
    nodes: [],
    edges: [],
    variables: {},
    createdAt: OLD_TIME,
  }
}

describe('Orphan Detection', () => {
  afterAll(() => {
    for (const taskId of createdTaskIds) {
      const taskDir = join(TASKS_DIR, taskId)
      if (existsSync(taskDir)) {
        rmSync(taskDir, { recursive: true, force: true })
      }
    }
  })

  it('无 process.json 且无 workflow → 不视为 orphan（从未执行）', () => {
    const task = createTestTask({ status: 'planning' })
    saveTaskBypassingGrace(task)
    // 不写 workflow.json，不写 process.json

    const orphans = detectOrphanedTasks()
    const found = orphans.find(o => o.task.id === task.id)

    expect(found).toBeUndefined()
  })

  it('有 workflow 无 process.json 且 status 为 planning → 视为 orphan', () => {
    const task = createTestTask({ status: 'planning' })
    saveTaskBypassingGrace(task)

    // 写入 workflow（说明曾开始执行）但没有 process.json
    saveTaskWorkflow(task.id, createTestWorkflow(task.id))

    const orphans = detectOrphanedTasks()
    const found = orphans.find(o => o.task.id === task.id)

    expect(found).toBeDefined()
    expect(found!.reason).toBe('process_not_found')
    expect(found!.pid).toBe(0)
  })

  it('有 workflow 无 process.json 且 status 为 developing → 视为 orphan', () => {
    const task = createTestTask({ status: 'developing' })
    saveTaskBypassingGrace(task)

    saveTaskWorkflow(task.id, createTestWorkflow(task.id))

    const orphans = detectOrphanedTasks()
    const found = orphans.find(o => o.task.id === task.id)

    expect(found).toBeDefined()
    expect(found!.reason).toBe('process_not_found')
  })

  it('有 process.json 且进程已死 → 视为 orphan', () => {
    const task = createTestTask({ status: 'developing' })
    saveTaskBypassingGrace(task)

    // 写入一个不存在的 PID
    const processInfo: ProcessInfo = {
      pid: 999999999,
      startedAt: OLD_TIME,
      status: 'running',
      lastHeartbeat: OLD_TIME,
    }
    saveProcessInfo(task.id, processInfo)

    const orphans = detectOrphanedTasks()
    const found = orphans.find(o => o.task.id === task.id)

    expect(found).toBeDefined()
    expect(found!.reason).toBe('process_not_found')
    expect(found!.pid).toBe(999999999)
  })

  it('进程状态为 stopped 不视为 orphan', () => {
    const task = createTestTask({ status: 'planning' })
    saveTaskBypassingGrace(task)

    const processInfo: ProcessInfo = {
      pid: 999999998,
      startedAt: OLD_TIME,
      status: 'stopped',
    }
    saveProcessInfo(task.id, processInfo)

    const orphans = detectOrphanedTasks()
    const found = orphans.find(o => o.task.id === task.id)

    expect(found).toBeUndefined()
  })

  it('新创建的任务（在宽限期内）不视为 orphan', () => {
    const now = new Date().toISOString()
    const task = createTestTask({
      status: 'planning',
      createdAt: now,
      updatedAt: now,
    })
    saveTask(task)

    const orphans = detectOrphanedTasks()
    const found = orphans.find(o => o.task.id === task.id)

    expect(found).toBeUndefined()
  })

  it('有 process.json 且进程存活（当前进程 PID）→ 不视为 orphan', () => {
    const task = createTestTask({ status: 'developing' })
    saveTaskBypassingGrace(task)

    // 使用当前进程 PID（一定存活）
    const processInfo: ProcessInfo = {
      pid: process.pid,
      startedAt: OLD_TIME,
      status: 'running',
      lastHeartbeat: new Date().toISOString(), // 新鲜心跳
    }
    saveProcessInfo(task.id, processInfo)

    const orphans = detectOrphanedTasks()
    const found = orphans.find(o => o.task.id === task.id)

    expect(found).toBeUndefined()
  })

  it('pending 状态的任务不参与 orphan 检测', () => {
    const task = createTestTask({ status: 'pending' })
    saveTaskBypassingGrace(task)

    saveTaskWorkflow(task.id, createTestWorkflow(task.id))

    const orphans = detectOrphanedTasks()
    const found = orphans.find(o => o.task.id === task.id)

    // pending 不在 RUNNING_STATUSES 中，不会被检测
    expect(found).toBeUndefined()
  })
})
