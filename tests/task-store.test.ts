/**
 * TaskStore 单元测试
 *
 * 测试策略：使用独立的测试目录，每个测试用例使用唯一的 taskId 前缀
 * 避免测试之间相互干扰
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'

import {
  // From TaskStore
  generateTaskId,
  createTaskFolder,
  getTaskFolder,
  saveTask,
  getTask,
  getAllTasks,
  getTasksByStatus,
  updateTask,
  deleteTask,
  saveProcessInfo,
  getProcessInfo,
  updateProcessInfo,
  isProcessRunning,
  type ProcessInfo,
  // From TaskWorkflowStore
  saveTaskWorkflow,
  getTaskWorkflow,
  saveTaskInstance,
  getTaskInstance,
  loadTaskFolder,
  // From TaskLogStore
  appendConversation,
  type ConversationEntry,
  // From paths
  TASKS_DIR,
} from '../src/store/index.js'

import type { Task } from '../src/types/task.js'
import type { Workflow, WorkflowInstance } from '../src/workflow/types.js'

// 测试用的唯一前缀，避免与真实数据冲突
const TEST_PREFIX = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

// 记录所有测试创建的任务 ID，用于清理
const createdTaskIds: string[] = []

function createTestTask(overrides: Partial<Task> = {}): Task {
  const id = overrides.id || `${TEST_PREFIX}-${Math.random().toString(36).slice(2, 8)}`
  createdTaskIds.push(id)
  return {
    id,
    title: 'Test Task',
    description: 'Test description',
    priority: 'medium',
    status: 'pending',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('TaskStore', () => {
  beforeAll(() => {
    // 确保测试目录存在
    if (!existsSync(TASKS_DIR)) {
      mkdirSync(TASKS_DIR, { recursive: true })
    }
  })

  afterAll(() => {
    // 清理所有测试创建的任务
    for (const taskId of createdTaskIds) {
      const taskDir = join(TASKS_DIR, taskId)
      if (existsSync(taskDir)) {
        rmSync(taskDir, { recursive: true, force: true })
      }
    }
  })

  describe('generateTaskId', () => {
    it('应生成符合格式的 taskId', () => {
      const taskId = generateTaskId('Test Task')
      expect(taskId).toMatch(/^task-\d{8}-\d{6}-[a-z0-9]{3,5}$/)
    })

    it('多次生成应返回不同的 ID', () => {
      const id1 = generateTaskId('Task 1')
      const id2 = generateTaskId('Task 2')
      expect(id1).not.toBe(id2)
    })
  })

  describe('createTaskFolder', () => {
    it('应创建任务文件夹结构', () => {
      const taskId = `${TEST_PREFIX}-folder-test`
      createdTaskIds.push(taskId)
      const taskDir = createTaskFolder(taskId)

      expect(existsSync(taskDir)).toBe(true)
      expect(existsSync(join(taskDir, 'logs'))).toBe(true)
      expect(existsSync(join(taskDir, 'outputs'))).toBe(true)
      // steps/ 目录已移除（未使用）
    })
  })

  describe('getTaskFolder', () => {
    it('存在的任务应返回正确路径', () => {
      const taskId = `${TEST_PREFIX}-getfolder-1`
      createdTaskIds.push(taskId)
      createTaskFolder(taskId)

      const folder = getTaskFolder(taskId)
      expect(folder).toBe(join(TASKS_DIR, taskId))
    })

    it('不存在的任务应返回 null', () => {
      const folder = getTaskFolder(`${TEST_PREFIX}-nonexistent-xyz`)
      expect(folder).toBe(null)
    })

    it('部分 ID 匹配应返回正确路径', () => {
      const taskId = `${TEST_PREFIX}-partial-match-xyz`
      const task = createTestTask({ id: taskId })
      saveTask(task)

      // 使用部分 ID 查找
      const folder = getTaskFolder(`${TEST_PREFIX}-partial`)
      expect(folder).toBe(join(TASKS_DIR, taskId))
    })
  })

  describe('Task CRUD', () => {
    describe('saveTask / getTask', () => {
      it('应正确保存和读取任务', () => {
        const task = createTestTask()
        saveTask(task)

        const retrieved = getTask(task.id)
        expect(retrieved).toEqual(task)
      })

      it('不存在的任务应返回 null', () => {
        const task = getTask(`${TEST_PREFIX}-not-found`)
        expect(task).toBe(null)
      })

      it('应自动创建任务文件夹', () => {
        const task = createTestTask()
        saveTask(task)

        expect(existsSync(join(TASKS_DIR, task.id))).toBe(true)
      })
    })

    describe('getAllTasks / getTasksByStatus', () => {
      it('应正确过滤测试创建的任务', () => {
        const pendingTask = createTestTask({ status: 'pending' })
        const completedTask = createTestTask({ status: 'completed' })

        saveTask(pendingTask)
        saveTask(completedTask)

        // 获取所有任务
        const allTasks = getAllTasks()
        const ourTasks = allTasks.filter(t => t.id.startsWith(TEST_PREFIX))
        expect(ourTasks.length).toBeGreaterThanOrEqual(2)

        // 按状态过滤
        const pending = getTasksByStatus('pending')
        const ourPending = pending.filter(t => t.id === pendingTask.id)
        expect(ourPending).toHaveLength(1)

        const completed = getTasksByStatus('completed')
        const ourCompleted = completed.filter(t => t.id === completedTask.id)
        expect(ourCompleted).toHaveLength(1)
      })

      it('应按创建时间倒序排列', () => {
        const oldTask = createTestTask({
          createdAt: '2020-01-01T00:00:00Z',
        })
        const newTask = createTestTask({
          createdAt: '2030-01-31T00:00:00Z',
        })

        saveTask(oldTask)
        saveTask(newTask)

        const tasks = getAllTasks()
        const newIndex = tasks.findIndex(t => t.id === newTask.id)
        const oldIndex = tasks.findIndex(t => t.id === oldTask.id)

        // newTask 应该在 oldTask 前面
        expect(newIndex).toBeLessThan(oldIndex)
      })
    })

    describe('updateTask', () => {
      it('应更新任务属性', () => {
        const task = createTestTask()
        saveTask(task)

        updateTask(task.id, { status: 'completed', title: 'Updated Title' })

        const updated = getTask(task.id)
        expect(updated?.status).toBe('completed')
        expect(updated?.title).toBe('Updated Title')
      })

      it('更新不存在的任务应不报错', () => {
        expect(() => updateTask(`${TEST_PREFIX}-nonexistent`, { status: 'failed' })).not.toThrow()
      })
    })

    describe('deleteTask', () => {
      it('应删除任务及其文件夹', () => {
        const task = createTestTask()
        saveTask(task)

        expect(getTask(task.id)).not.toBe(null)

        deleteTask(task.id)

        expect(getTask(task.id)).toBe(null)
        expect(existsSync(join(TASKS_DIR, task.id))).toBe(false)

        // 从清理列表移除，因为已经删除
        const index = createdTaskIds.indexOf(task.id)
        if (index > -1) createdTaskIds.splice(index, 1)
      })

      it('删除不存在的任务应不报错', () => {
        expect(() => deleteTask(`${TEST_PREFIX}-nonexistent`)).not.toThrow()
      })
    })
  })

  describe('Workflow 存储', () => {
    const mockWorkflow: Workflow = {
      id: 'wf-test',
      name: 'Test Workflow',
      description: 'Test',
      nodes: [],
      edges: [],
    }

    it('应保存和读取 workflow', () => {
      const task = createTestTask()
      saveTask(task)

      saveTaskWorkflow(task.id, mockWorkflow)
      const retrieved = getTaskWorkflow(task.id)

      expect(retrieved).toEqual(mockWorkflow)
    })

    it('任务不存在时应返回 null', () => {
      const workflow = getTaskWorkflow(`${TEST_PREFIX}-nonexistent`)
      expect(workflow).toBe(null)
    })
  })

  describe('Instance 存储', () => {
    const mockInstance: WorkflowInstance = {
      id: 'inst-test',
      workflowId: 'wf-test',
      status: 'running',
      nodeStates: {},
      variables: {},
      outputs: {},
      startedAt: new Date().toISOString(),
    }

    it('应保存和读取 instance', () => {
      const task = createTestTask()
      saveTask(task)

      saveTaskInstance(task.id, mockInstance)
      const retrieved = getTaskInstance(task.id)

      expect(retrieved).toEqual(mockInstance)
    })

    it('任务不存在时应返回 null', () => {
      const instance = getTaskInstance(`${TEST_PREFIX}-nonexistent`)
      expect(instance).toBe(null)
    })
  })

  describe('ProcessInfo 存储', () => {
    const mockProcessInfo: ProcessInfo = {
      pid: 12345,
      startedAt: new Date().toISOString(),
      status: 'running',
    }

    it('应保存和读取进程信息', () => {
      const task = createTestTask()
      saveTask(task)

      saveProcessInfo(task.id, mockProcessInfo)
      const retrieved = getProcessInfo(task.id)

      expect(retrieved).toEqual(mockProcessInfo)
    })

    it('应更新进程信息', () => {
      const task = createTestTask()
      saveTask(task)
      saveProcessInfo(task.id, mockProcessInfo)

      updateProcessInfo(task.id, { status: 'stopped' })

      const updated = getProcessInfo(task.id)
      expect(updated?.status).toBe('stopped')
      expect(updated?.pid).toBe(12345)
    })
  })

  describe('isProcessRunning', () => {
    it('当前进程应返回 true', () => {
      expect(isProcessRunning(process.pid)).toBe(true)
    })

    it('不存在的 PID 应返回 false', () => {
      // 使用一个很大的 PID，几乎肯定不存在
      expect(isProcessRunning(999999999)).toBe(false)
    })
  })

  describe('loadTaskFolder', () => {
    it('应加载完整的任务文件夹', () => {
      const task = createTestTask()
      saveTask(task)

      const workflow: Workflow = {
        id: 'wf-load-test',
        name: 'Test',
        description: '',
        nodes: [],
        edges: [],
      }
      saveTaskWorkflow(task.id, workflow)

      const folder = loadTaskFolder(task.id)

      expect(folder).not.toBe(null)
      expect(folder?.task).toEqual(task)
      expect(folder?.workflow).toEqual(workflow)
      expect(folder?.taskId).toBe(task.id)
    })

    it('任务不存在时应返回 null', () => {
      const folder = loadTaskFolder(`${TEST_PREFIX}-nonexistent`)
      expect(folder).toBe(null)
    })
  })

  describe('Conversation 日志', () => {
    it('应追加对话记录', () => {
      const task = createTestTask()
      saveTask(task)

      const entry: ConversationEntry = {
        timestamp: new Date().toISOString(),
        phase: 'planning',
        nodeId: 'node-1',
        nodeName: 'Test Node',
        prompt: 'Test prompt',
        response: 'Test response',
        durationMs: 1000,
      }

      appendConversation(task.id, entry)

      const logPath = join(TASKS_DIR, task.id, 'logs', 'conversation.log')
      expect(existsSync(logPath)).toBe(true)

      const content = readFileSync(logPath, 'utf-8')
      expect(content).toContain('Test prompt')
      expect(content).toContain('Test response')
      expect(content).toContain('planning')
    })
  })
})
