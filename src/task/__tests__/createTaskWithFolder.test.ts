/**
 * createTaskWithFolder 测试
 *
 * 测试任务创建、cwd 记录、目录结构、ID 唯一性
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTaskWithFolder } from '../createTaskWithFolder.js'
import { getTask, getTaskFolder } from '../../store/TaskStore.js'
import { DATA_DIR } from '../../store/paths.js'

// DATA_DIR is set to temp dir by vitest.config.ts env CAH_DATA_DIR

describe('createTaskWithFolder', () => {
  beforeEach(() => {
    // Ensure data dir exists
    mkdirSync(join(DATA_DIR, 'tasks'), { recursive: true })
  })

  it('should create a task with correct fields', () => {
    const task = createTaskWithFolder({ description: 'Test task description' })

    expect(task.id).toMatch(/^task-/)
    expect(task.title).toBe('Test task description')
    expect(task.description).toBe('Test task description')
    expect(task.priority).toBe('medium')
    expect(task.status).toBe('pending')
    expect(task.retryCount).toBe(0)
    expect(task.createdAt).toBeTruthy()
  })

  it('should record cwd in task.json', () => {
    const task = createTaskWithFolder({ description: 'CWD test' })

    expect(task.cwd).toBe(process.cwd())

    // Verify persisted task also has cwd
    const persisted = getTask(task.id)
    expect(persisted).not.toBeNull()
    expect(persisted!.cwd).toBe(process.cwd())
  })

  it('should create task folder on disk', () => {
    const task = createTaskWithFolder({ description: 'Folder test' })

    const folder = getTaskFolder(task.id)
    expect(folder).not.toBeNull()
    expect(existsSync(folder!)).toBe(true)
  })

  it('should generate unique IDs', () => {
    const task1 = createTaskWithFolder({ description: 'Unique test 1' })
    const task2 = createTaskWithFolder({ description: 'Unique test 2' })

    expect(task1.id).not.toBe(task2.id)
  })

  it('should parse priority correctly', () => {
    const highTask = createTaskWithFolder({ description: 'High priority', priority: 'high' })
    expect(highTask.priority).toBe('high')

    const lowTask = createTaskWithFolder({ description: 'Low priority', priority: 'low' })
    expect(lowTask.priority).toBe('low')

    // Invalid priority defaults to medium
    const invalidTask = createTaskWithFolder({ description: 'Invalid priority', priority: 'urgent' as any })
    expect(invalidTask.priority).toBe('medium')
  })

  it('should truncate long descriptions for title', () => {
    const longDesc = 'A'.repeat(100)
    const task = createTaskWithFolder({ description: longDesc })

    expect(task.title.length).toBeLessThanOrEqual(53) // 50 + "..."
    expect(task.description).toBe(longDesc)
  })

  it('should pass optional fields through', () => {
    const task = createTaskWithFolder({
      description: 'Optional fields',
      assignee: 'alice',
      backend: 'claude-code',
      model: 'opus',
    })

    expect(task.assignee).toBe('alice')
    expect(task.backend).toBe('claude-code')
    expect(task.model).toBe('opus')
  })
})
