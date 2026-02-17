/**
 * resumeTask 测试
 *
 * 测试 orphan 检测和任务恢复逻辑
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectOrphanedTasks } from '../resumeTask.js'
import { createTaskWithFolder } from '../createTaskWithFolder.js'
import { getTask, saveProcessInfo, updateTask } from '../../store/TaskStore.js'
import { DATA_DIR } from '../../store/paths.js'

// DATA_DIR is set to temp dir by vitest.config.ts env CAH_DATA_DIR

/**
 * Helper: force-write task.json with old timestamps to bypass
 * saveTask/updateTask which always set updatedAt to now.
 */
function forceWriteTaskWithOldTime(taskId: string, status: 'developing' | 'planning') {
  const task = getTask(taskId)!
  const oldTime = new Date(Date.now() - 60_000).toISOString()
  task.status = status
  task.updatedAt = oldTime
  task.createdAt = oldTime
  const taskDir = join(DATA_DIR, 'tasks', taskId)
  writeFileSync(join(taskDir, 'task.json'), JSON.stringify(task, null, 2))
}

describe('detectOrphanedTasks', () => {
  beforeEach(() => {
    mkdirSync(join(DATA_DIR, 'tasks'), { recursive: true })
  })

  it('should return empty array when no running tasks', () => {
    const orphans = detectOrphanedTasks()
    expect(orphans).toEqual([])
  })

  it('should not detect tasks within grace period as orphaned', () => {
    const task = createTaskWithFolder({ description: 'Grace period test' })
    updateTask(task.id, { status: 'developing' })

    // Task just created, within 30s grace period
    const orphans = detectOrphanedTasks()
    expect(orphans).toEqual([])
  })

  it('should detect orphaned task when process is dead and past grace period', () => {
    const task = createTaskWithFolder({ description: 'Orphan test' })
    forceWriteTaskWithOldTime(task.id, 'developing')

    // Write process.json with a dead PID
    saveProcessInfo(task.id, {
      pid: 999999, // unlikely to exist
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      status: 'running',
    })

    const orphans = detectOrphanedTasks()
    expect(orphans.length).toBe(1)
    expect(orphans[0]!.task.id).toBe(task.id)
    expect(orphans[0]!.reason).toBe('process_not_found')
  })

  it('should not detect task as orphaned when process is alive', () => {
    const task = createTaskWithFolder({ description: 'Alive process test' })
    forceWriteTaskWithOldTime(task.id, 'developing')

    // Write process.json with current PID (alive)
    saveProcessInfo(task.id, {
      pid: process.pid,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      status: 'running',
      lastHeartbeat: new Date().toISOString(),
    })

    const orphans = detectOrphanedTasks()
    expect(orphans).toEqual([])
  })

  it('should skip tasks whose process status is not running', () => {
    const task = createTaskWithFolder({ description: 'Stopped process test' })
    forceWriteTaskWithOldTime(task.id, 'developing')

    saveProcessInfo(task.id, {
      pid: 999999,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      status: 'stopped',
    })

    const orphans = detectOrphanedTasks()
    expect(orphans).toEqual([])
  })

  it('should detect planning tasks as potential orphans', () => {
    const task = createTaskWithFolder({ description: 'Planning orphan test' })
    forceWriteTaskWithOldTime(task.id, 'planning')

    saveProcessInfo(task.id, {
      pid: 999999,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      status: 'running',
    })

    const orphans = detectOrphanedTasks()
    expect(orphans.length).toBe(1)
  })
})
