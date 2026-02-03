/**
 * High 优先级任务功能测试（Vitest 版本）
 * 测试 high 优先级任务的创建、执行、优先级处理和队列顺序
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createTask } from '../src/task/createTask'
import { getTask, getAllTasks, updateTask } from '../src/store/TaskStore'

describe('High Priority Task Tests', () => {
  let testTaskId: string

  describe('1. 任务创建', () => {
    it('应该成功创建 high 优先级任务', async () => {
      const task = await createTask({
        title: 'High优先级Vitest测试任务',
        description: '用于 vitest 测试的 high 优先级任务',
        priority: 'high',
      })

      testTaskId = task.id

      expect(task).toBeDefined()
      expect(task.id).toBeDefined()
      expect(task.title).toBe('High优先级Vitest测试任务')
      expect(task.priority).toBe('high')
      expect(task.status).toBe('pending')
      expect(task.createdAt).toBeDefined()
    })

    it('应该能够读取创建的任务', async () => {
      const task = await getTask(testTaskId)

      expect(task).toBeDefined()
      expect(task.id).toBe(testTaskId)
      expect(task.priority).toBe('high')
    })
  })

  describe('2. 优先级验证', () => {
    it('任务优先级应该正确设置为 high', async () => {
      const task = await getTask(testTaskId)

      expect(task.priority).toBe('high')
    })

    it('high 优先级任务应该存在于任务列表中', async () => {
      const tasks = await getAllTasks()
      const highTasks = tasks.filter(t => t.priority === 'high')

      expect(tasks.length).toBeGreaterThan(0)
      expect(highTasks.length).toBeGreaterThan(0)
      expect(highTasks.some(t => t.id === testTaskId)).toBe(true)
    })
  })

  describe('3. 队列优先级分析', () => {
    it('应该能够正确统计不同优先级的任务数量', async () => {
      const tasks = await getAllTasks()
      const highTasks = tasks.filter(t => t.priority === 'high')
      const mediumTasks = tasks.filter(t => t.priority === 'medium')
      const lowTasks = tasks.filter(t => t.priority === 'low')

      expect(tasks.length).toBeGreaterThan(0)
      expect(highTasks.length).toBeGreaterThan(0)

      // 验证优先级分布合理
      const totalPriorityTasks = highTasks.length + mediumTasks.length + lowTasks.length
      expect(totalPriorityTasks).toBe(tasks.length)
    })

    it('应该能够识别待执行的 high 优先级任务', async () => {
      const tasks = await getAllTasks()
      const pendingHighTasks = tasks.filter(
        t => t.priority === 'high' && t.status === 'pending'
      )

      expect(pendingHighTasks.length).toBeGreaterThanOrEqual(1)
      expect(pendingHighTasks.some(t => t.id === testTaskId)).toBe(true)
    })
  })

  describe('4. 任务状态流转', () => {
    it('应该能够将任务状态从 pending 更新为 planning', async () => {
      updateTask(testTaskId, { status: 'planning' })
      const task = await getTask(testTaskId)

      expect(task.status).toBe('planning')
      expect(task.updatedAt).toBeDefined()
    })

    it('应该能够将任务状态从 planning 更新为 developing', async () => {
      updateTask(testTaskId, { status: 'developing' })
      const task = await getTask(testTaskId)

      expect(task.status).toBe('developing')
    })

    it('应该能够将任务状态从 developing 更新为 reviewing', async () => {
      updateTask(testTaskId, { status: 'reviewing' })
      const task = await getTask(testTaskId)

      expect(task.status).toBe('reviewing')
    })

    it('应该能够将任务状态从 reviewing 更新为 completed', async () => {
      updateTask(testTaskId, { status: 'completed' })
      const task = await getTask(testTaskId)

      expect(task.status).toBe('completed')
      expect(task.updatedAt).toBeDefined()
    })
  })

  describe('5. 最终状态验证', () => {
    it('任务应该处于 completed 状态', async () => {
      const task = await getTask(testTaskId)

      expect(task.status).toBe('completed')
      expect(task.priority).toBe('high')
      expect(task.updatedAt).toBeDefined()
    })

    it('completed 任务应该包含完整的元数据', async () => {
      const task = await getTask(testTaskId)

      expect(task.id).toBeDefined()
      expect(task.title).toBeDefined()
      expect(task.description).toBeDefined()
      expect(task.priority).toBe('high')
      expect(task.status).toBe('completed')
      expect(task.createdAt).toBeDefined()
      expect(task.updatedAt).toBeDefined()
    })
  })

  describe('6. 性能和数据完整性', () => {
    it('任务数据应该保持一致性', async () => {
      const task = await getTask(testTaskId)
      const allTasks = await getAllTasks()
      const taskInList = allTasks.find(t => t.id === testTaskId)

      expect(taskInList).toBeDefined()
      expect(taskInList?.id).toBe(task.id)
      expect(taskInList?.title).toBe(task.title)
      expect(taskInList?.priority).toBe(task.priority)
      expect(taskInList?.status).toBe(task.status)
    })

    it('updatedAt 时间戳应该晚于 createdAt', async () => {
      const task = await getTask(testTaskId)

      expect(task.createdAt).toBeDefined()
      expect(task.updatedAt).toBeDefined()

      const createdTime = new Date(task.createdAt).getTime()
      const updatedTime = new Date(task.updatedAt!).getTime()

      expect(updatedTime).toBeGreaterThanOrEqual(createdTime)
    })
  })
})
