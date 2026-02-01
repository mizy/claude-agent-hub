/**
 * Task Store - 平铺结构的任务文件夹存储
 *
 * 目录结构:
 * data/tasks/
 * └── task-20260131-HHMMSS-xxx/
 *     ├── task.json                       # 任务元数据 (包含 status)
 *     ├── workflow.json                   # 生成的 workflow
 *     ├── instance.json                   # workflow 实例状态
 *     ├── process.json                    # 后台进程信息
 *     ├── logs/
 *     │   └── execution.log
 *     ├── outputs/
 *     │   └── result.md
 *     └── steps/
 *         └── step-{n}.json
 *
 * 注意：不再使用 index.json 缓存，直接扫描文件夹
 */

import { existsSync, readdirSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { format } from 'date-fns'
import { createLogger } from '../shared/logger.js'
import type { Task, TaskStatus } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'
import {
  DATA_DIR,
  TASKS_DIR,
  TASK_FILE,
  WORKFLOW_FILE,
  INSTANCE_FILE,
  PROCESS_FILE,
  getTaskDir,
  getTaskLogsDir,
  getTaskOutputsDir,
  getTaskStepsDir,
  getExecutionLogPath,
  getConversationLogFilePath,
  getResultFilePath,
  getStepFilePath,
} from './paths.js'
import { readJson, writeJson, appendToFile, ensureDirs } from './json.js'

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

// Process info for background execution
export interface ProcessInfo {
  pid: number
  startedAt: string
  status: 'running' | 'stopped' | 'crashed'
  lastHeartbeat?: string
  error?: string
}

// Task folder contents
export interface TaskFolder {
  path: string
  taskId: string
  task: Task
  workflow?: Workflow
  instance?: WorkflowInstance
  process?: ProcessInfo
}

// Ensure directories exist
function initDirs(): void {
  ensureDirs(DATA_DIR, TASKS_DIR)
}

// ============ 扫描任务文件夹 ============

/**
 * 扫描所有任务文件夹，返回有效的任务目录名列表
 */
function scanTaskFolders(): string[] {
  initDirs()

  if (!existsSync(TASKS_DIR)) return []

  return readdirSync(TASKS_DIR).filter(f => {
    // 跳过索引文件和临时文件
    if (f === 'index.json' || f.endsWith('.tmp')) return false
    const fullPath = join(TASKS_DIR, f)
    // 只保留包含 task.json 的目录
    return existsSync(join(fullPath, TASK_FILE))
  })
}

// Generate task ID: task-{YYYYMMDD}-{HHMMSS}-{random}
// Example: task-20260131-094532-a3f
export function generateTaskId(_title: string): string {
  initDirs()
  const now = new Date()
  const date = format(now, 'yyyyMMdd')
  const time = format(now, 'HHmmss')
  const random = Math.random().toString(36).slice(2, 5) // 3 char random

  const baseId = `task-${date}-${time}-${random}`

  // Check for collision (very unlikely)
  if (existsSync(join(TASKS_DIR, baseId))) {
    const extra = Math.random().toString(36).slice(2, 4)
    return `task-${date}-${time}-${random}${extra}`
  }
  return baseId
}

// Create task folder structure (flat structure, no status subdirectories)
export function createTaskFolder(taskId: string, _status?: TaskStatus): string {
  initDirs()
  const taskDir = getTaskDir(taskId)
  mkdirSync(taskDir, { recursive: true })
  mkdirSync(getTaskLogsDir(taskId), { recursive: true })
  mkdirSync(getTaskOutputsDir(taskId), { recursive: true })
  mkdirSync(getTaskStepsDir(taskId), { recursive: true })
  return taskDir
}

// Get task folder path (flat structure)
export function getTaskFolder(taskId: string): string | null {
  initDirs()

  // Direct lookup
  const path = getTaskDir(taskId)
  if (existsSync(path)) {
    return path
  }

  // Try partial match
  const match = findTaskByPartialId(taskId)
  if (match) {
    return getTaskDir(match)
  }

  return null
}

// Get task folder path (for compatibility, status is ignored in flat structure)
export function getTaskFolderByStatus(taskId: string, _status: TaskStatus): string {
  return getTaskDir(taskId)
}

// ============ Task CRUD ============

// Save task (flat structure)
export function saveTask(task: Task): void {
  initDirs()

  const taskDir = getTaskDir(task.id)

  // Create folder if not exists
  if (!existsSync(taskDir)) {
    createTaskFolder(task.id)
  }

  // Update timestamp
  task.updatedAt = new Date().toISOString()

  // Save task.json
  writeJson(join(taskDir, TASK_FILE), task)

  logger.debug(`Saved task: ${task.id} (status: ${task.status})`)
}

// Get task
export function getTask(taskId: string): Task | null {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null
  return readJson<Task>(join(taskDir, TASK_FILE))
}

// Find task by partial ID
function findTaskByPartialId(partialId: string): string | null {
  const folders = scanTaskFolders()
  const match = folders.find(f => f.startsWith(partialId) || f.includes(partialId))
  return match || null
}

// Get all tasks (直接扫描文件夹)
export function getAllTasks(): Task[] {
  const folders = scanTaskFolders()

  const tasks = folders
    .map(folder => readJson<Task>(join(TASKS_DIR, folder, TASK_FILE)))
    .filter((t): t is Task => t !== null)

  // 按创建时间倒序
  tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return tasks
}

// 获取任务摘要列表 (扫描文件夹)
export function getAllTaskSummaries(): TaskSummary[] {
  return getAllTasks().map(toSummary)
}

// Get tasks by status (扫描文件夹并过滤)
export function getTasksByStatus(status: TaskStatus): Task[] {
  return getAllTasks().filter(t => t.status === status)
}

// 获取指定状态的任务摘要
export function getTaskSummariesByStatus(status: TaskStatus): TaskSummary[] {
  return getTasksByStatus(status).map(toSummary)
}

// Update task
export function updateTask(taskId: string, updates: Partial<Task>): void {
  const task = getTask(taskId)
  if (!task) {
    logger.warn(`Task not found: ${taskId}`)
    return
  }

  const updated = { ...task, ...updates }
  saveTask(updated)
}

// Delete task
export function deleteTask(taskId: string): void {
  const taskDir = getTaskFolder(taskId)
  if (taskDir && existsSync(taskDir)) {
    rmSync(taskDir, { recursive: true, force: true })
    logger.debug(`Deleted task folder: ${taskDir}`)
  }
}

// ============ Workflow in Task Folder ============

// Save workflow to task folder
export function saveTaskWorkflow(taskId: string, workflow: Workflow): void {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    logger.warn(`Task folder not found for: ${taskId}`)
    return
  }
  writeJson(join(taskDir, WORKFLOW_FILE), workflow)
  logger.debug(`Saved workflow for task: ${taskId}`)
}

// Get workflow from task folder
export function getTaskWorkflow(taskId: string): Workflow | null {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null
  return readJson<Workflow>(join(taskDir, WORKFLOW_FILE))
}

// Save workflow instance to task folder
export function saveTaskInstance(taskId: string, instance: WorkflowInstance): void {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    logger.warn(`Task folder not found for: ${taskId}`)
    return
  }
  writeJson(join(taskDir, INSTANCE_FILE), instance)
}

// Get workflow instance from task folder
export function getTaskInstance(taskId: string): WorkflowInstance | null {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null
  return readJson<WorkflowInstance>(join(taskDir, INSTANCE_FILE))
}

// ============ Process Info ============

// Save process info
export function saveProcessInfo(taskId: string, info: ProcessInfo): void {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    logger.warn(`Task folder not found for: ${taskId}`)
    return
  }
  writeJson(join(taskDir, PROCESS_FILE), info)
}

// Get process info
export function getProcessInfo(taskId: string): ProcessInfo | null {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null
  return readJson<ProcessInfo>(join(taskDir, PROCESS_FILE))
}

// Update process info
export function updateProcessInfo(taskId: string, updates: Partial<ProcessInfo>): void {
  const info = getProcessInfo(taskId)
  if (info) {
    saveProcessInfo(taskId, { ...info, ...updates })
  }
}

// Check if process is running
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ============ Step Records ============

// Save step output
export function saveStepOutput(taskId: string, stepNumber: number, output: unknown): void {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return
  writeJson(getStepFilePath(taskId, stepNumber), output)
}

// ============ Logs ============

// Get log file path
export function getLogPath(taskId: string): string {
  return getExecutionLogPath(taskId)
}

// Get output file path
export function getOutputPath(taskId: string): string {
  return getResultFilePath(taskId)
}

// Get workflow file path
export function getWorkflowPath(taskId: string): string {
  return join(getTaskDir(taskId), WORKFLOW_FILE)
}

// Get instance file path
export function getInstancePath(taskId: string): string {
  return join(getTaskDir(taskId), INSTANCE_FILE)
}

// ============ Load Full Task Folder ============

// Load complete task folder
export function loadTaskFolder(taskId: string): TaskFolder | null {
  const task = getTask(taskId)
  if (!task) return null

  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null

  return {
    path: taskDir,
    taskId: taskId,
    task,
    workflow: getTaskWorkflow(taskId) || undefined,
    instance: getTaskInstance(taskId) || undefined,
    process: getProcessInfo(taskId) || undefined,
  }
}

// ============ Conversation Logging ============

export interface ConversationEntry {
  timestamp: string
  phase: 'planning' | 'executing'
  nodeId?: string
  nodeName?: string
  prompt: string
  response: string
  durationMs: number
  /** API 耗时毫秒数 */
  durationApiMs?: number
  /** 花费 USD */
  costUsd?: number
}

// Append conversation entry to task logs
export function appendConversation(taskId: string, entry: ConversationEntry): void {
  const logDir = getTaskLogsDir(taskId)
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }

  const logPath = getConversationLogFilePath(taskId)
  const separator = '\n' + '='.repeat(80) + '\n'

  const logContent = [
    separator,
    `[${entry.timestamp}] Phase: ${entry.phase}`,
    entry.nodeId ? `Node: ${entry.nodeId} (${entry.nodeName || 'unnamed'})` : '',
    `Duration: ${entry.durationMs}ms`,
    '',
    '--- PROMPT ---',
    entry.prompt,
    '',
    '--- RESPONSE ---',
    entry.response,
    separator,
  ].filter(Boolean).join('\n')

  appendToFile(logPath, logContent)
  logger.debug(`Logged conversation for task ${taskId}`)
}

// Get conversation log path
export function getConversationLogPath(taskId: string): string {
  return getConversationLogFilePath(taskId)
}

// ============ Execution Log (for stop/resume/events) ============

/**
 * Append a log entry to the execution log
 * Used for tracking stop/resume and other lifecycle events
 */
export function appendExecutionLog(taskId: string, message: string): void {
  const logPath = getExecutionLogPath(taskId)
  const logDir = getTaskLogsDir(taskId)

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }

  const timestamp = new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const logLine = `${timestamp} INF ${message}\n`
  appendToFile(logPath, logLine)
}

// Initialize on module load
initDirs()
