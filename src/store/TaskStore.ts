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
 */

import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'fs'
import { join } from 'path'
import { format } from 'date-fns'
import { createLogger } from '../shared/logger.js'
import type { Task, TaskStatus } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'

const logger = createLogger('task-store')

// Data directory
const DATA_DIR = join(process.cwd(), 'data')
const TASKS_DIR = join(DATA_DIR, 'tasks')

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
function ensureDirs(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true })
}

// Generate task ID: task-{YYYYMMDD}-{HHMMSS}-{random}
// Example: task-20260131-094532-a3f
export function generateTaskId(_title: string): string {
  ensureDirs()
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
  ensureDirs()
  const taskDir = join(TASKS_DIR, taskId)
  mkdirSync(taskDir, { recursive: true })
  mkdirSync(join(taskDir, 'logs'), { recursive: true })
  mkdirSync(join(taskDir, 'outputs'), { recursive: true })
  mkdirSync(join(taskDir, 'steps'), { recursive: true })
  return taskDir
}

// Get task folder path (flat structure)
export function getTaskFolder(taskId: string): string | null {
  ensureDirs()

  // Direct lookup
  const path = join(TASKS_DIR, taskId)
  if (existsSync(path)) {
    return path
  }

  // Try partial match
  const match = findTaskByPartialId(taskId)
  if (match) {
    return join(TASKS_DIR, match)
  }

  return null
}

// Get task folder path (for compatibility, status is ignored in flat structure)
export function getTaskFolderByStatus(taskId: string, _status: TaskStatus): string {
  return join(TASKS_DIR, taskId)
}

// Read JSON file
function readJsonSync<T>(filepath: string): T | null {
  try {
    const content = readFileSync(filepath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

// Write JSON file with atomic rename
function writeJsonSync(filepath: string, data: unknown): void {
  const tempPath = `${filepath}.tmp`
  writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tempPath, filepath)
}

// ============ Task CRUD ============

// Save task (flat structure, no folder movement)
export function saveTask(task: Task): void {
  ensureDirs()

  const taskDir = join(TASKS_DIR, task.id)

  // Create folder if not exists
  if (!existsSync(taskDir)) {
    createTaskFolder(task.id)
  }

  // Save task.json
  writeJsonSync(join(taskDir, 'task.json'), task)

  logger.debug(`Saved task: ${task.id} (status: ${task.status})`)
}

// Get task
export function getTask(taskId: string): Task | null {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null
  return readJsonSync<Task>(join(taskDir, 'task.json'))
}

// Find task by partial ID
function findTaskByPartialId(partialId: string): string | null {
  ensureDirs()

  if (!existsSync(TASKS_DIR)) return null

  const folders = readdirSync(TASKS_DIR).filter(f => {
    const fullPath = join(TASKS_DIR, f)
    // Only check directories that contain task.json
    return existsSync(join(fullPath, 'task.json'))
  })

  const match = folders.find(f => f.startsWith(partialId) || f.includes(partialId))
  return match || null
}

// Get all tasks
export function getAllTasks(): Task[] {
  ensureDirs()

  if (!existsSync(TASKS_DIR)) return []

  const folders = readdirSync(TASKS_DIR).filter(f => {
    const fullPath = join(TASKS_DIR, f)
    return existsSync(join(fullPath, 'task.json'))
  })

  const tasks = folders
    .map(f => readJsonSync<Task>(join(TASKS_DIR, f, 'task.json')))
    .filter((t): t is Task => t !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return tasks
}

// Get tasks by status (filter from all tasks)
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

  const updated = { ...task, ...updates }
  saveTask(updated)
}

// Delete task
export function deleteTask(taskId: string): void {
  const taskDir = getTaskFolder(taskId)
  if (taskDir && existsSync(taskDir)) {
    rmSync(taskDir, { recursive: true, force: true })
    logger.debug(`Deleted task: ${taskId}`)
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
  writeJsonSync(join(taskDir, 'workflow.json'), workflow)
  logger.debug(`Saved workflow for task: ${taskId}`)
}

// Get workflow from task folder
export function getTaskWorkflow(taskId: string): Workflow | null {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null
  return readJsonSync<Workflow>(join(taskDir, 'workflow.json'))
}

// Save workflow instance to task folder
export function saveTaskInstance(taskId: string, instance: WorkflowInstance): void {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    logger.warn(`Task folder not found for: ${taskId}`)
    return
  }
  writeJsonSync(join(taskDir, 'instance.json'), instance)
}

// Get workflow instance from task folder
export function getTaskInstance(taskId: string): WorkflowInstance | null {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null
  return readJsonSync<WorkflowInstance>(join(taskDir, 'instance.json'))
}

// ============ Process Info ============

// Save process info
export function saveProcessInfo(taskId: string, info: ProcessInfo): void {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    logger.warn(`Task folder not found for: ${taskId}`)
    return
  }
  writeJsonSync(join(taskDir, 'process.json'), info)
}

// Get process info
export function getProcessInfo(taskId: string): ProcessInfo | null {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null
  return readJsonSync<ProcessInfo>(join(taskDir, 'process.json'))
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
  const stepPath = join(taskDir, 'steps', `step-${stepNumber.toString().padStart(3, '0')}.json`)
  writeJsonSync(stepPath, output)
}

// ============ Logs ============

// Get log file path
export function getLogPath(taskId: string): string {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    // Return a path that will be created when needed
    return join(TASKS_DIR, taskId, 'logs', 'execution.log')
  }
  return join(taskDir, 'logs', 'execution.log')
}

// Get output file path
export function getOutputPath(taskId: string): string {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    return join(TASKS_DIR, taskId, 'outputs', 'result.md')
  }
  return join(taskDir, 'outputs', 'result.md')
}

// Get workflow file path
export function getWorkflowPath(taskId: string): string {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    return join(TASKS_DIR, taskId, 'workflow.json')
  }
  return join(taskDir, 'workflow.json')
}

// Get instance file path
export function getInstancePath(taskId: string): string {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    return join(TASKS_DIR, taskId, 'instance.json')
  }
  return join(taskDir, 'instance.json')
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
    taskId,
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
}

// Append conversation entry to task logs
export function appendConversation(taskId: string, entry: ConversationEntry): void {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    logger.warn(`Task folder not found for conversation log: ${taskId}`)
    return
  }

  const logDir = join(taskDir, 'logs')
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }

  const logPath = join(logDir, 'conversation.log')
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

  appendFileSync(logPath, logContent, 'utf-8')
  logger.debug(`Logged conversation for task ${taskId}`)
}

// Get conversation log path
export function getConversationLogPath(taskId: string): string {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    return join(TASKS_DIR, taskId, 'logs', 'conversation.log')
  }
  return join(taskDir, 'logs', 'conversation.log')
}

// Initialize on module load
ensureDirs()
