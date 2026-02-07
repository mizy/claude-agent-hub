/**
 * Medium 优先级任务执行测试
 * 测试任务的创建、执行和完成流程
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTask } from '../src/task/createTask'
import { getTask, getAllTasks, updateTask, deleteTask } from '../src/store/TaskStore'

describe('Medium 优先级任务测试', () => {
  let taskId: string

  afterAll(async () => {
    // 清理测试数据
    if (taskId) {
      try {
        await deleteTask(taskId)
      } catch (e) {
        // 忽略清理错误
      }
    }
  })

  it('应该成功创建 medium 优先级任务', async () => {
    const createdTask = await createTask({
      title: 'Medium优先级测试任务',
      description: '这是一个用于测试 medium 优先级的测试任务',
      priority: 'medium',
    })

    taskId = createdTask.id
    expect(taskId).toMatch(/^[a-f0-9-]+$/)
    expect(createdTask.priority).toBe('medium')
  })

  it('应该正确获取任务信息', async () => {
    const task = await getTask(taskId)

    expect(task.id).toBe(taskId)
    expect(task.title).toBe('Medium优先级测试任务')
    expect(task.priority).toBe('medium')
    expect(task.status).toBe('pending')
    expect(task.createdAt).toBeTruthy()
  })

  it('应该在任务列表中找到任务', async () => {
    const tasks = await getAllTasks()
    const mediumTasks = tasks.filter(t => t.priority === 'medium')

    expect(tasks.length).toBeGreaterThan(0)
    expect(mediumTasks.length).toBeGreaterThan(0)

    const found = tasks.find(t => t.id === taskId)
    expect(found).toBeTruthy()
  })

  it('应该能够更新任务状态', async () => {
    // pending → developing
    updateTask(taskId, { status: 'developing' })
    let task = await getTask(taskId)
    expect(task.status).toBe('developing')

    // developing → reviewing
    updateTask(taskId, { status: 'reviewing' })
    task = await getTask(taskId)
    expect(task.status).toBe('reviewing')

    // reviewing → completed
    updateTask(taskId, { status: 'completed' })
    task = await getTask(taskId)
    expect(task.status).toBe('completed')
  })

  it('应该正确更新 updatedAt 时间戳', async () => {
    const task = await getTask(taskId)

    expect(task.updatedAt).toBeTruthy()
    expect(new Date(task.updatedAt).getTime()).toBeGreaterThan(
      new Date(task.createdAt).getTime()
    )
  })
})
