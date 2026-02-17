/**
 * pauseResumeTask 测试
 *
 * 测试任务暂停和恢复的状态转换
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pauseTask, resumePausedTask } from '../pauseResumeTask.js'
import { createTaskWithFolder } from '../createTaskWithFolder.js'
import { updateTask, saveProcessInfo } from '../../store/TaskStore.js'
import { DATA_DIR } from '../../store/paths.js'
import { spawnTaskProcess } from '../spawnTask.js'

vi.mock('../spawnTask.js', () => ({
  spawnTaskProcess: vi.fn(() => 12345),
}))

// DATA_DIR is set to temp dir by vitest.config.ts env CAH_DATA_DIR

describe('pauseResumeTask', () => {
  beforeEach(() => {
    mkdirSync(join(DATA_DIR, 'tasks'), { recursive: true })
  })

  describe('pauseTask', () => {
    it('should pause a developing task', () => {
      const task = createTaskWithFolder({ description: 'Pause test' })
      updateTask(task.id, { status: 'developing' })

      const result = pauseTask(task.id)

      expect(result.success).toBe(true)
      expect(result.task?.status).toBe('paused')
    })

    it('should reject pausing a pending task', () => {
      const task = createTaskWithFolder({ description: 'Pending pause test' })
      // task starts as 'pending'

      const result = pauseTask(task.id)

      expect(result.success).toBe(false)
      expect(result.error).toContain('pending')
    })

    it('should reject pausing a completed task', () => {
      const task = createTaskWithFolder({ description: 'Completed pause test' })
      updateTask(task.id, { status: 'completed' })

      const result = pauseTask(task.id)

      expect(result.success).toBe(false)
      expect(result.error).toContain('completed')
    })

    it('should reject pausing a failed task', () => {
      const task = createTaskWithFolder({ description: 'Failed pause test' })
      updateTask(task.id, { status: 'failed' })

      const result = pauseTask(task.id)

      expect(result.success).toBe(false)
    })

    it('should return error for non-existent task', () => {
      const result = pauseTask('non-existent-id')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('resumePausedTask', () => {
    it('should reject resuming a non-paused task', () => {
      const task = createTaskWithFolder({ description: 'Not paused resume test' })
      updateTask(task.id, { status: 'developing' })

      const result = resumePausedTask(task.id)

      expect(result.success).toBe(false)
      expect(result.error).toContain('developing')
    })

    it('should auto-spawn new process when process is not running', () => {
      const task = createTaskWithFolder({ description: 'Dead process resume test' })
      updateTask(task.id, { status: 'paused' })

      // No process.json → process is dead, should auto-spawn
      const result = resumePausedTask(task.id)

      expect(result.success).toBe(true)
      expect(result.task?.status).toBe('developing')
      expect(spawnTaskProcess).toHaveBeenCalledWith({ taskId: task.id, resume: true })
    })

    it('should resume a paused task when process is alive', () => {
      const task = createTaskWithFolder({ description: 'Resume test' })
      updateTask(task.id, { status: 'paused' })

      // Write process.json with current PID (which is alive)
      saveProcessInfo(task.id, {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        status: 'running',
      })

      const result = resumePausedTask(task.id)

      expect(result.success).toBe(true)
      expect(result.task?.status).toBe('developing')
    })

    it('should return error for non-existent task', () => {
      const result = resumePausedTask('non-existent-id')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })
})
