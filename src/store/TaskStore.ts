/**
 * Task Store - Task CRUD 和进程管理
 *
 * 基于 FileStore（目录模式）实现，目录结构:
 * data/tasks/
 * └── task-20260131-HHMMSS-xxx/
 *     ├── task.json        # 任务元数据 (包含 status)
 *     ├── process.json     # 后台进程信息
 *     └── ...
 *
 * 内部使用 FileStore 作为底层存储，对外保持原有 API。
 */

import { existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { format } from 'date-fns'
import { createLogger } from '../shared/logger.js'
import type { Task, TaskStatus } from '../types/task.js'
import {
  DATA_DIR,
  TASKS_DIR,
  TASK_FILE,
  PROCESS_FILE,
  getTaskDir,
  getTaskLogsDir,
  getTaskOutputsDir,
} from './paths.js'
import { readJson, writeJson, ensureDirs } from './readWriteJson.js'
import { FileStore } from './GenericFileStore.js'

const logger = createLogger('task-store')

// ============ Task Summary (用于列表显示) ============

export interface TaskSummary {
  id: string
  title: string
  status: TaskStatus
  priority: string
  createdAt: string
  updatedAt?: string
}

// 从 Task 提取 Summary
function toSummary(task: Task): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

// Stop reason for process termination
export type ProcessStopReason = 'completed' | 'killed' | 'timeout' | 'error' | 'conflict'

// Process info for background execution
export interface ProcessInfo {
  pid: number
  startedAt: string
  status: 'running' | 'stopped' | 'crashed'
  lastHeartbeat?: string
  error?: string
  /** Process exit code (0 = success) */
  exitCode?: number
  /** Reason for stopping */
  stopReason?: ProcessStopReason
  /** Path to stderr log file if errors occurred */
  stderrLogPath?: string
}

// Ensure directories exist
function initDirs(): void {
  ensureDirs(DATA_DIR, TASKS_DIR)
}

// ============ FileStore 实例（底层存储） ============

// Task 存储：目录模式，支持部分 ID 匹配
const taskStore = new FileStore<Task, TaskSummary>({
  dir: TASKS_DIR,
  mode: 'directory',
  dataFile: TASK_FILE,
  partialIdMatch: true,
  toSummary,
})

// ============ Task ID 生成和文件夹创建 ============

// Generate task ID: task-{YYYYMMDD}-{HHMMSS}-{random}
export function generateTaskId(_title: string): string {
  initDirs()
  const now = new Date()
  const date = format(now, 'yyyyMMdd')
  const time = format(now, 'HHmmss')
  const random = Math.random().toString(36).slice(2, 5)

  const baseId = `task-${date}-${time}-${random}`

  // Check for collision (very unlikely)
  if (existsSync(join(TASKS_DIR, baseId))) {
    const extra = Math.random().toString(36).slice(2, 4)
    return `task-${date}-${time}-${random}${extra}`
  }
  return baseId
}

// Create task folder structure
// 注：steps/ 目录已移除（未使用）
export function createTaskFolder(taskId: string, _status?: TaskStatus): string {
  initDirs()
  const taskDir = getTaskDir(taskId)
  mkdirSync(taskDir, { recursive: true })
  mkdirSync(getTaskLogsDir(taskId), { recursive: true })
  mkdirSync(getTaskOutputsDir(taskId), { recursive: true })
  return taskDir
}

// Get task folder path
// 返回任务文件夹路径（目录存在即可，不要求 task.json 必须存在）
export function getTaskFolder(taskId: string): string | null {
  // 先尝试通过 FileStore 解析（会检查 task.json）
  const resolvedId = taskStore.resolveId(taskId)
  if (resolvedId) {
    return taskStore.getEntityPath(resolvedId)
  }

  // 如果 task.json 不存在，检查目录本身是否存在
  const taskDir = getTaskDir(taskId)
  if (existsSync(taskDir)) {
    return taskDir
  }

  // 支持部分 ID 匹配：扫描目录名
  if (!existsSync(TASKS_DIR)) return null
  const entries = readdirSync(TASKS_DIR)
  const match = entries.find(entry => entry.startsWith(taskId) || entry.includes(taskId))
  if (match) {
    const matchedDir = join(TASKS_DIR, match)
    if (existsSync(matchedDir)) {
      return matchedDir
    }
  }

  return null
}

// ============ Task CRUD ============

// Save task
export function saveTask(task: Task): void {
  initDirs()

  const taskDir = getTaskDir(task.id)

  // Create folder if not exists
  if (!existsSync(taskDir)) {
    createTaskFolder(task.id)
  }

  // Update timestamp
  task.updatedAt = new Date().toISOString()

  // Save using FileStore
  taskStore.setSync(task.id, task)

  logger.debug(`Saved task: ${task.id} (status: ${task.status})`)
}

// Get task
export function getTask(taskId: string): Task | null {
  return taskStore.getSync(taskId)
}

// Get all tasks (直接扫描文件夹)
export function getAllTasks(): Task[] {
  const tasks = taskStore.getAllSync()

  // 按创建时间倒序
  tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return tasks
}

// 获取任务摘要列表
export function getAllTaskSummaries(): TaskSummary[] {
  return getAllTasks().map(toSummary)
}

// Get tasks by status
export function getTasksByStatus(status: TaskStatus): Task[] {
  return getAllTasks().filter(t => t.status === status)
}

// Update task
export function updateTask(taskId: string, updates: Partial<Task>): void {
  const task = getTask(taskId)
  if (!task) {
    logger.warn(`Task not found: ${taskId}`)
    return
  }

  // 状态变化时记录日志
  if (updates.status && updates.status !== task.status) {
    logger.info(`[STATUS] ${task.id.slice(0, 8)} ${task.status} → ${updates.status}`)

    // 同时写入任务日志文件（异步，延迟导入避免循环依赖）
    import('./TaskLogStore.js')
      .then(({ appendExecutionLog }) => {
        appendExecutionLog(taskId, `[STATUS] ${task.status} → ${updates.status}`, {
          scope: 'lifecycle',
          level: updates.status === 'failed' ? 'error' : 'info',
        })
      })
      .catch(() => {
        // 忽略日志写入失败
      })
  }

  const updated = { ...task, ...updates }
  saveTask(updated)
}

// Delete task
export function deleteTask(taskId: string): void {
  const deleted = taskStore.deleteSync(taskId)
  if (deleted) {
    logger.debug(`Deleted task: ${taskId}`)
  }
}

// ============ Process Info (聚合导出) ============

function saveProcessInfoFn(taskId: string, info: ProcessInfo): void {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    logger.warn(`Task folder not found for: ${taskId}`)
    return
  }
  writeJson(join(taskDir, PROCESS_FILE), info)
}

function getProcessInfoFn(taskId: string): ProcessInfo | null {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null
  return readJson<ProcessInfo>(join(taskDir, PROCESS_FILE))
}

function updateProcessInfoFn(taskId: string, updates: Partial<ProcessInfo>): void {
  const info = getProcessInfoFn(taskId)
  if (info) {
    saveProcessInfoFn(taskId, { ...info, ...updates })
  }
}

function isProcessRunningFn(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 兼容性单独导出
export const saveProcessInfo = saveProcessInfoFn
export const getProcessInfo = getProcessInfoFn
export const updateProcessInfo = updateProcessInfoFn
export const isProcessRunning = isProcessRunningFn

// Initialize on module load
initDirs()
