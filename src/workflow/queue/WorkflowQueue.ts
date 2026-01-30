/**
 * Workflow 任务队列
 * 基于 SQLite 实现，无需外部依赖
 */

import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { createLogger } from '../../shared/logger.js'
import { generateId } from '../../shared/id.js'
import type { NodeJobData } from '../types.js'

const logger = createLogger('workflow-queue')

let db: Database.Database | null = null

type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'

interface Job {
  id: string
  name: string
  data: NodeJobData
  status: JobStatus
  priority: number
  delay: number
  attempts: number
  maxAttempts: number
  createdAt: string
  processAt: string
  completedAt?: string
  error?: string
}

function getDb(): Database.Database {
  if (db) return db

  const dataDir = join(process.cwd(), '.claude-agent-hub')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  db = new Database(join(dataDir, 'queue.db'))

  // 创建队列表
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      priority INTEGER NOT NULL DEFAULT 0,
      delay INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL,
      process_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_process_at ON jobs(process_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_instance ON jobs(json_extract(data, '$.instanceId'));
  `)

  logger.debug('Queue database initialized')
  return db
}

// 入队节点任务
export async function enqueueNode(
  data: NodeJobData,
  options?: {
    delay?: number
    priority?: number
  }
): Promise<string> {
  const database = getDb()

  const jobId = `${data.instanceId}:${data.nodeId}:${data.attempt}`
  const now = new Date()
  const processAt = options?.delay
    ? new Date(now.getTime() + options.delay)
    : now

  const stmt = database.prepare(`
    INSERT OR REPLACE INTO jobs (id, name, data, status, priority, delay, attempts, max_attempts, created_at, process_at)
    VALUES (?, ?, ?, 'waiting', ?, ?, 0, 3, ?, ?)
  `)

  stmt.run(
    jobId,
    `node:${data.nodeId}`,
    JSON.stringify(data),
    options?.priority || 0,
    options?.delay || 0,
    now.toISOString(),
    processAt.toISOString()
  )

  logger.debug(`Enqueued node job: ${jobId}`)

  return jobId
}

// 批量入队
export async function enqueueNodes(
  nodes: Array<{
    data: NodeJobData
    options?: { delay?: number; priority?: number }
  }>
): Promise<string[]> {
  const database = getDb()
  const ids: string[] = []

  const stmt = database.prepare(`
    INSERT OR REPLACE INTO jobs (id, name, data, status, priority, delay, attempts, max_attempts, created_at, process_at)
    VALUES (?, ?, ?, 'waiting', ?, ?, 0, 3, ?, ?)
  `)

  const now = new Date()

  const insertMany = database.transaction(() => {
    for (const { data, options } of nodes) {
      const jobId = `${data.instanceId}:${data.nodeId}:${data.attempt}`
      const processAt = options?.delay
        ? new Date(now.getTime() + options.delay)
        : now

      stmt.run(
        jobId,
        `node:${data.nodeId}`,
        JSON.stringify(data),
        options?.priority || 0,
        options?.delay || 0,
        now.toISOString(),
        processAt.toISOString()
      )

      ids.push(jobId)
    }
  })

  insertMany()

  logger.debug(`Enqueued ${ids.length} node jobs`)

  return ids
}

// 获取下一个待处理的任务
export function getNextJob(): Job | null {
  const database = getDb()
  const now = new Date().toISOString()

  // 获取优先级最高、创建时间最早的待处理任务
  const row = database.prepare(`
    SELECT * FROM jobs
    WHERE status = 'waiting' AND process_at <= ?
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).get(now) as Record<string, unknown> | undefined

  if (!row) return null

  // 标记为处理中
  database.prepare(`UPDATE jobs SET status = 'active' WHERE id = ?`).run(row.id)

  return {
    id: row.id as string,
    name: row.name as string,
    data: JSON.parse(row.data as string),
    status: 'active',
    priority: row.priority as number,
    delay: row.delay as number,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    createdAt: row.created_at as string,
    processAt: row.process_at as string,
  }
}

// 标记任务完成
export function completeJob(jobId: string): void {
  const database = getDb()
  database.prepare(`
    UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ?
  `).run(new Date().toISOString(), jobId)
}

// 标记任务失败
export function failJob(jobId: string, error: string): void {
  const database = getDb()

  const row = database.prepare(`SELECT attempts, max_attempts FROM jobs WHERE id = ?`)
    .get(jobId) as { attempts: number; max_attempts: number } | undefined

  if (row && row.attempts + 1 < row.max_attempts) {
    // 还有重试机会，重新入队
    const backoffDelay = Math.pow(2, row.attempts) * 1000 // 指数退避
    const processAt = new Date(Date.now() + backoffDelay)

    database.prepare(`
      UPDATE jobs SET status = 'waiting', attempts = attempts + 1, process_at = ?, error = ?
      WHERE id = ?
    `).run(processAt.toISOString(), error, jobId)

    logger.debug(`Job ${jobId} will retry after ${backoffDelay}ms`)
  } else {
    // 重试用尽，标记失败
    database.prepare(`
      UPDATE jobs SET status = 'failed', completed_at = ?, error = ?
      WHERE id = ?
    `).run(new Date().toISOString(), error, jobId)
  }
}

// 获取队列统计
export async function getQueueStats(): Promise<{
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}> {
  const database = getDb()
  const now = new Date().toISOString()

  const stats = database.prepare(`
    SELECT
      SUM(CASE WHEN status = 'waiting' AND process_at <= ? THEN 1 ELSE 0 END) as waiting,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'waiting' AND process_at > ? THEN 1 ELSE 0 END) as delayed
    FROM jobs
  `).get(now, now) as Record<string, number>

  return {
    waiting: stats.waiting || 0,
    active: stats.active || 0,
    completed: stats.completed || 0,
    failed: stats.failed || 0,
    delayed: stats.delayed || 0,
  }
}

// 获取待处理任务列表
export function getWaitingJobs(): Job[] {
  const database = getDb()
  const now = new Date().toISOString()

  const rows = database.prepare(`
    SELECT * FROM jobs WHERE status = 'waiting' AND process_at <= ?
    ORDER BY priority DESC, created_at ASC
  `).all(now) as Record<string, unknown>[]

  return rows.map(row => ({
    id: row.id as string,
    name: row.name as string,
    data: JSON.parse(row.data as string),
    status: row.status as JobStatus,
    priority: row.priority as number,
    delay: row.delay as number,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    createdAt: row.created_at as string,
    processAt: row.process_at as string,
  }))
}

// 清空队列
export async function drainQueue(): Promise<void> {
  const database = getDb()
  database.prepare(`DELETE FROM jobs WHERE status IN ('waiting', 'delayed')`).run()
  logger.info('Queue drained')
}

// 关闭队列（清理资源）
export async function closeQueue(): Promise<void> {
  if (db) {
    db.close()
    db = null
  }
  logger.info('Queue closed')
}

// 移除特定工作流的所有待处理任务
export async function removeWorkflowJobs(instanceId: string): Promise<number> {
  const database = getDb()

  const result = database.prepare(`
    DELETE FROM jobs
    WHERE status IN ('waiting', 'delayed')
    AND json_extract(data, '$.instanceId') = ?
  `).run(instanceId)

  logger.debug(`Removed ${result.changes} jobs for instance ${instanceId}`)

  return result.changes
}

// 清理已完成的旧任务（保留最近 N 条）
export function cleanupOldJobs(keepCount: number = 100): number {
  const database = getDb()

  // 获取需要保留的最小 ID
  const row = database.prepare(`
    SELECT id FROM jobs
    WHERE status IN ('completed', 'failed')
    ORDER BY completed_at DESC
    LIMIT 1 OFFSET ?
  `).get(keepCount) as { id: string } | undefined

  if (!row) return 0

  const result = database.prepare(`
    DELETE FROM jobs
    WHERE status IN ('completed', 'failed')
    AND completed_at < (SELECT completed_at FROM jobs WHERE id = ?)
  `).run(row.id)

  return result.changes
}
