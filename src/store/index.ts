/**
 * SQLite 数据存储
 * 保持简单接口，内部使用 Result 处理错误
 */

import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { createLogger } from '../shared/logger.js'
import type { Agent } from '../types/agent.js'
import type { Task } from '../types/task.js'

const logger = createLogger('store')

let db: Database.Database | null = null

function getDbPath(): string {
  const dataDir = join(process.cwd(), '.claude-agent-hub')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
  return join(dataDir, 'data.db')
}

function initDb(): Database.Database {
  if (db) return db

  db = new Database(getDbPath())

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      persona TEXT NOT NULL,
      persona_config TEXT,
      description TEXT,
      status TEXT DEFAULT 'idle',
      current_task TEXT,
      stats TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'pending',
      assignee TEXT,
      branch TEXT,
      plan TEXT,
      retry_count INTEGER DEFAULT 0,
      last_reject_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
    CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
  `)

  logger.debug('Database initialized')
  return db
}

// 行转换函数
function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    persona: row.persona as string,
    personaConfig: row.persona_config ? JSON.parse(row.persona_config as string) : undefined,
    description: row.description as string,
    status: row.status as Agent['status'],
    currentTask: row.current_task as string | undefined,
    stats: JSON.parse((row.stats as string) || '{}'),
    createdAt: row.created_at as string,
  }
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    priority: row.priority as Task['priority'],
    status: row.status as Task['status'],
    assignee: row.assignee as string | undefined,
    branch: row.branch as string | undefined,
    plan: row.plan ? JSON.parse(row.plan as string) : undefined,
    retryCount: row.retry_count as number,
    lastRejectReason: row.last_reject_reason as string | undefined,
    createdAt: row.created_at as string,
  }
}

// Store 接口（保持原有简单接口）
export interface Store {
  // Agent 操作
  saveAgent(agent: Agent): void
  getAgent(name: string): Agent | null
  getAllAgents(): Agent[]
  updateAgent(name: string, updates: Partial<Agent>): void
  deleteAgent(name: string): void

  // Task 操作
  saveTask(task: Task): void
  getTask(id: string): Task | null
  getAllTasks(): Task[]
  getTasksByStatus(status: Task['status']): Task[]
  updateTask(id: string, updates: Partial<Task>): void
  deleteTask(id: string): void

  // Meta 操作
  getDaemonPid(): number | null
  setDaemonPid(pid: number | null): void
}

function createStore(): Store {
  const database = initDb()

  return {
    // Agent 操作
    saveAgent(agent: Agent): void {
      const stmt = database.prepare(`
        INSERT OR REPLACE INTO agents
        (id, name, persona, persona_config, description, status, current_task, stats, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      stmt.run(
        agent.id,
        agent.name,
        agent.persona,
        agent.personaConfig ? JSON.stringify(agent.personaConfig) : null,
        agent.description,
        agent.status,
        agent.currentTask || null,
        JSON.stringify(agent.stats),
        agent.createdAt
      )
    },

    getAgent(name: string): Agent | null {
      const stmt = database.prepare('SELECT * FROM agents WHERE name = ?')
      const row = stmt.get(name) as Record<string, unknown> | undefined
      return row ? rowToAgent(row) : null
    },

    getAllAgents(): Agent[] {
      const stmt = database.prepare('SELECT * FROM agents ORDER BY created_at')
      const rows = stmt.all() as Record<string, unknown>[]
      return rows.map(rowToAgent)
    },

    updateAgent(name: string, updates: Partial<Agent>): void {
      const agent = this.getAgent(name)
      if (!agent) return
      const updated = { ...agent, ...updates }
      this.saveAgent(updated)
    },

    deleteAgent(name: string): void {
      const stmt = database.prepare('DELETE FROM agents WHERE name = ?')
      stmt.run(name)
    },

    // Task 操作
    saveTask(task: Task): void {
      const stmt = database.prepare(`
        INSERT OR REPLACE INTO tasks
        (id, title, description, priority, status, assignee, branch, plan, retry_count, last_reject_reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      stmt.run(
        task.id,
        task.title,
        task.description,
        task.priority,
        task.status,
        task.assignee || null,
        task.branch || null,
        task.plan ? JSON.stringify(task.plan) : null,
        task.retryCount,
        task.lastRejectReason || null,
        task.createdAt,
        new Date().toISOString()
      )
    },

    getTask(id: string): Task | null {
      const stmt = database.prepare('SELECT * FROM tasks WHERE id LIKE ?')
      const row = stmt.get(`${id}%`) as Record<string, unknown> | undefined
      return row ? rowToTask(row) : null
    },

    getAllTasks(): Task[] {
      const stmt = database.prepare('SELECT * FROM tasks ORDER BY created_at DESC')
      const rows = stmt.all() as Record<string, unknown>[]
      return rows.map(rowToTask)
    },

    getTasksByStatus(status: Task['status']): Task[] {
      const stmt = database.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC')
      const rows = stmt.all(status) as Record<string, unknown>[]
      return rows.map(rowToTask)
    },

    updateTask(id: string, updates: Partial<Task>): void {
      const task = this.getTask(id)
      if (!task) return
      const updated = { ...task, ...updates }
      this.saveTask(updated)
    },

    deleteTask(id: string): void {
      const stmt = database.prepare('DELETE FROM tasks WHERE id LIKE ?')
      stmt.run(`${id}%`)
    },

    // Meta 操作
    getDaemonPid(): number | null {
      const stmt = database.prepare('SELECT value FROM meta WHERE key = ?')
      const row = stmt.get('daemon_pid') as { value: string } | undefined
      return row ? parseInt(row.value, 10) : null
    },

    setDaemonPid(pid: number | null): void {
      const stmt = database.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      stmt.run('daemon_pid', pid?.toString() || null)
    },
  }
}

// 单例
let storeInstance: Store | null = null

export function getStore(): Store {
  if (!storeInstance) {
    storeInstance = createStore()
  }
  return storeInstance
}

// 重置（用于测试）
export function resetStore(): void {
  db?.close()
  db = null
  storeInstance = null
}
