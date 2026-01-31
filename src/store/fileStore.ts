/**
 * File-based storage
 *
 * Structure:
 * data/
 * ├── agents/
 * │   └── {name}.json
 * ├── tasks/
 * │   └── {taskId}/
 * │       ├── task.json
 * │       ├── workflow.json
 * │       └── ...
 * └── meta.json
 *
 * Task 操作委托给 TaskStore（平铺结构）
 */

import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../shared/logger.js'
import type { Agent } from '../types/agent.js'
import type { Task, TaskStatus } from '../types/task.js'
import {
  saveTask as taskStoreSave,
  getTask as taskStoreGet,
  getAllTasks as taskStoreGetAll,
  getTasksByStatus as taskStoreGetByStatus,
  updateTask as taskStoreUpdate,
  deleteTask as taskStoreDelete,
} from './TaskStore.js'

const logger = createLogger('store')

// Data directory
const DATA_DIR = join(process.cwd(), 'data')
const AGENTS_DIR = join(DATA_DIR, 'agents')
const META_FILE = join(DATA_DIR, 'meta.json')

// Ensure directories exist
function ensureDirs(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true })
}

// Initialize on module load
ensureDirs()

// Read JSON file sync
function readJsonSync<T>(filepath: string): T | null {
  try {
    const content = readFileSync(filepath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

// Write JSON file sync
function writeJsonSync(filepath: string, data: unknown): void {
  const dir = join(filepath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8')
}

// Store interface
export interface FileStore {
  // Agent operations
  saveAgent(agent: Agent): void
  getAgent(name: string): Agent | null
  getAllAgents(): Agent[]
  updateAgent(name: string, updates: Partial<Agent>): void
  deleteAgent(name: string): void

  // Task operations (delegated to TaskStore)
  saveTask(task: Task): void
  getTask(id: string): Task | null
  getAllTasks(): Task[]
  getTasksByStatus(status: TaskStatus): Task[]
  updateTask(id: string, updates: Partial<Task>): void
  deleteTask(id: string): void

  // Meta operations
  getDaemonPid(): number | null
  setDaemonPid(pid: number | null): void
}

function createFileStore(): FileStore {
  return {
    // Agent operations
    saveAgent(agent: Agent): void {
      const filepath = join(AGENTS_DIR, `${agent.name}.json`)
      writeJsonSync(filepath, agent)
      logger.debug(`Saved agent: ${agent.name}`)
    },

    getAgent(name: string): Agent | null {
      const filepath = join(AGENTS_DIR, `${name}.json`)
      return readJsonSync<Agent>(filepath)
    },

    getAllAgents(): Agent[] {
      if (!existsSync(AGENTS_DIR)) return []
      const files = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json'))
      return files
        .map(f => readJsonSync<Agent>(join(AGENTS_DIR, f)))
        .filter((a): a is Agent => a !== null)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    },

    updateAgent(name: string, updates: Partial<Agent>): void {
      const agent = this.getAgent(name)
      if (!agent) return
      const updated = { ...agent, ...updates }
      this.saveAgent(updated)
    },

    deleteAgent(name: string): void {
      const filepath = join(AGENTS_DIR, `${name}.json`)
      if (existsSync(filepath)) {
        rmSync(filepath)
        logger.debug(`Deleted agent: ${name}`)
      }
    },

    // Task operations - delegate to TaskStore
    saveTask(task: Task): void {
      taskStoreSave(task)
    },

    getTask(id: string): Task | null {
      return taskStoreGet(id)
    },

    getAllTasks(): Task[] {
      return taskStoreGetAll()
    },

    getTasksByStatus(status: TaskStatus): Task[] {
      return taskStoreGetByStatus(status)
    },

    updateTask(id: string, updates: Partial<Task>): void {
      taskStoreUpdate(id, updates)
    },

    deleteTask(id: string): void {
      taskStoreDelete(id)
    },

    // Meta operations
    getDaemonPid(): number | null {
      const meta = readJsonSync<{ daemonPid?: number }>(META_FILE)
      return meta?.daemonPid ?? null
    },

    setDaemonPid(pid: number | null): void {
      const meta = readJsonSync<Record<string, unknown>>(META_FILE) ?? {}
      meta.daemonPid = pid ?? undefined
      writeJsonSync(META_FILE, meta)
    },
  }
}

// Singleton
let storeInstance: FileStore | null = null

export function getFileStore(): FileStore {
  if (!storeInstance) {
    storeInstance = createFileStore()
  }
  return storeInstance
}

// Reset (for testing)
export function resetFileStore(): void {
  storeInstance = null
}
