/**
 * File-based storage
 *
 * Structure:
 * data/
 * ├── agents/
 * │   └── {name}.json
 * ├── tasks/
 * │   ├── pending/
 * │   ├── planning/
 * │   ├── developing/
 * │   ├── completed/
 * │   │   └── {date}/
 * │   │       └── {title}_{shortId}.json
 * │   ├── failed/
 * │   └── cancelled/
 * └── meta.json
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { readFile, writeFile, unlink, mkdir, readdir } from 'fs/promises'
import { join, basename } from 'path'
import { createLogger } from '../shared/logger.js'
import { formatTime, now } from '../shared/time.js'
import { shortenId } from '../shared/id.js'
import type { Agent } from '../types/agent.js'
import type { Task, TaskStatus } from '../types/task.js'

const logger = createLogger('store')

// Data directory
const DATA_DIR = join(process.cwd(), 'data')
const AGENTS_DIR = join(DATA_DIR, 'agents')
const TASKS_DIR = join(DATA_DIR, 'tasks')
const META_FILE = join(DATA_DIR, 'meta.json')

const TASK_STATUS_DIRS: TaskStatus[] = ['pending', 'planning', 'developing', 'completed', 'failed', 'cancelled']

// Ensure directories exist
function ensureDirs(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true })
  if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true })

  for (const status of TASK_STATUS_DIRS) {
    const dir = join(TASKS_DIR, status)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

// Initialize on module load
ensureDirs()

// Sanitize filename
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 50)
    .replace(/^_+|_+$/g, '')
}

// Read JSON file
async function readJson<T>(filepath: string): Promise<T | null> {
  try {
    const content = await readFile(filepath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

// Read JSON file sync
function readJsonSync<T>(filepath: string): T | null {
  try {
    const { readFileSync } = require('fs')
    const content = readFileSync(filepath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

// Write JSON file
async function writeJson(filepath: string, data: unknown): Promise<void> {
  await mkdir(join(filepath, '..'), { recursive: true })
  await writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8')
}

// Write JSON file sync
function writeJsonSync(filepath: string, data: unknown): void {
  const { writeFileSync } = require('fs')
  const dir = join(filepath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8')
}

// Get task filepath by status
function getTaskFilepath(task: Task): string {
  if (task.status === 'completed') {
    const date = formatTime(now(), 'yyyy-MM-dd')
    const filename = `${sanitizeFilename(task.title) || 'task'}_${shortenId(task.id, 8)}.json`
    return join(TASKS_DIR, 'completed', date, filename)
  }
  return join(TASKS_DIR, task.status, `${task.id}.json`)
}

// Find task file across all status directories
function findTaskFile(id: string): { filepath: string; status: TaskStatus } | null {
  for (const status of TASK_STATUS_DIRS) {
    const dir = join(TASKS_DIR, status)
    if (!existsSync(dir)) continue

    if (status === 'completed') {
      // Search in date subdirectories
      const dateDirs = readdirSync(dir).filter(d => statSync(join(dir, d)).isDirectory())
      for (const dateDir of dateDirs) {
        const files = readdirSync(join(dir, dateDir))
        for (const file of files) {
          if (file.includes(id.slice(0, 8)) && file.endsWith('.json')) {
            return { filepath: join(dir, dateDir, file), status: status as TaskStatus }
          }
        }
      }
    } else {
      // Direct lookup
      const filepath = join(dir, `${id}.json`)
      if (existsSync(filepath)) {
        return { filepath, status: status as TaskStatus }
      }
      // Try partial match
      const files = readdirSync(dir)
      for (const file of files) {
        if (file.startsWith(id) && file.endsWith('.json')) {
          return { filepath: join(dir, file), status: status as TaskStatus }
        }
      }
    }
  }
  return null
}

// Store interface
export interface FileStore {
  // Agent operations
  saveAgent(agent: Agent): void
  getAgent(name: string): Agent | null
  getAllAgents(): Agent[]
  updateAgent(name: string, updates: Partial<Agent>): void
  deleteAgent(name: string): void

  // Task operations
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

    // Task operations
    saveTask(task: Task): void {
      // Find and remove old file if status changed
      const existing = findTaskFile(task.id)
      if (existing && existing.status !== task.status) {
        try { rmSync(existing.filepath) } catch { /* ignore */ }
      }

      const filepath = getTaskFilepath(task)
      writeJsonSync(filepath, task)
      logger.debug(`Saved task: ${task.id} (${task.status})`)
    },

    getTask(id: string): Task | null {
      const found = findTaskFile(id)
      if (!found) return null
      return readJsonSync<Task>(found.filepath)
    },

    getAllTasks(): Task[] {
      const tasks: Task[] = []

      for (const status of TASK_STATUS_DIRS) {
        const dir = join(TASKS_DIR, status)
        if (!existsSync(dir)) continue

        if (status === 'completed') {
          // Read from date subdirectories
          const dateDirs = readdirSync(dir).filter(d => {
            try { return statSync(join(dir, d)).isDirectory() } catch { return false }
          })
          for (const dateDir of dateDirs) {
            const files = readdirSync(join(dir, dateDir)).filter(f => f.endsWith('.json'))
            for (const file of files) {
              const task = readJsonSync<Task>(join(dir, dateDir, file))
              if (task) tasks.push(task)
            }
          }
        } else {
          const files = readdirSync(dir).filter(f => f.endsWith('.json'))
          for (const file of files) {
            const task = readJsonSync<Task>(join(dir, file))
            if (task) tasks.push(task)
          }
        }
      }

      return tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    },

    getTasksByStatus(status: TaskStatus): Task[] {
      return this.getAllTasks().filter(t => t.status === status)
    },

    updateTask(id: string, updates: Partial<Task>): void {
      const task = this.getTask(id)
      if (!task) return
      const updated = { ...task, ...updates }
      this.saveTask(updated)
    },

    deleteTask(id: string): void {
      const found = findTaskFile(id)
      if (found) {
        try { rmSync(found.filepath) } catch { /* ignore */ }
        logger.debug(`Deleted task: ${id}`)
      }
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
