/**
 * Express HTTP Server
 *
 * 提供 REST API 和静态文件服务来可视化 Workflow 执行状态
 */

import express, { type Request, type Response } from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from '../shared/logger.js'
import {
  getAllTasks,
  getTask,
  getTaskWorkflow,
  getTaskInstance,
  getExecutionTimeline,
  getLogPath,
  getOutputPath,
} from '../store/index.js'
import {
  getRunningTasks,
  getQueuedTasks,
  getTodaySummary,
  getRecentCompleted,
} from '../report/SummaryDataCollector.js'
import { stopTask, deleteTask, completeTask } from '../task/manageTaskLifecycle.js'
import { resumeTask } from '../task/resumeTask.js'
import { spawnTaskProcess } from '../task/spawnTask.js'
import { getStore } from '../store/index.js'
import { parseTaskPriority } from '../types/task.js'
import type { Task } from '../types/task.js'

import { existsSync, readFileSync } from 'fs'

const logger = createLogger('server')

const DEFAULT_PORT = 3000

// Get the public directory path
// When bundled by tsup, the code is in dist/cli/index.js
// The public folder is at dist/server/public
const currentFile = fileURLToPath(import.meta.url)
const currentDir = dirname(currentFile)
// Go up from dist/cli to dist, then down to server/public
const publicDir = join(currentDir, '..', 'server', 'public')

export interface ServerOptions {
  port?: number
  host?: string
  open?: boolean
}

/**
 * 启动 HTTP Server
 */
export function startServer(options: ServerOptions = {}): void {
  const port = options.port || DEFAULT_PORT
  const host = options.host || 'localhost'

  const app = express()

  // Middleware
  app.use(express.json())

  // CORS for development
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  // ============ API Routes ============

  // GET /api/summary - 实时摘要
  app.get('/api/summary', (_req: Request, res: Response) => {
    try {
      const summary = {
        generatedAt: new Date().toISOString(),
        runningTasks: getRunningTasks(),
        queuedTasks: getQueuedTasks(),
        todaySummary: getTodaySummary(),
        recentCompleted: getRecentCompleted(5),
      }
      res.json(summary)
    } catch (err) {
      logger.error('Failed to get summary', err)
      res.status(500).json({ error: 'Failed to get summary' })
    }
  })

  // GET /api/tasks - 任务列表
  app.get('/api/tasks', (_req: Request, res: Response) => {
    try {
      const tasks = getAllTasks()
      // 按创建时间倒序
      tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      res.json(tasks)
    } catch (err) {
      logger.error('Failed to get tasks', err)
      res.status(500).json({ error: 'Failed to get tasks' })
    }
  })

  // GET /api/tasks/:id - 任务详情（包含 workflow 和 instance）
  app.get('/api/tasks/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params
      const task = getTask(id)

      if (!task) {
        res.status(404).json({ error: 'Task not found' })
        return
      }

      const workflow = getTaskWorkflow(id)
      const instance = getTaskInstance(id)

      res.json({
        task,
        workflow,
        instance,
      })
    } catch (err) {
      logger.error('Failed to get task', err)
      res.status(500).json({ error: 'Failed to get task' })
    }
  })

  // GET /api/tasks/:id/timeline - 事件时间线
  app.get('/api/tasks/:id/timeline', (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params
      const timeline = getExecutionTimeline(id)
      res.json(timeline || [])
    } catch (err) {
      logger.error('Failed to get timeline', err)
      res.status(500).json({ error: 'Failed to get timeline' })
    }
  })

  // ============ Task Actions API ============

  // POST /api/tasks - 创建新任务
  app.post('/api/tasks', (req: Request, res: Response) => {
    try {
      const { description, priority } = req.body

      if (!description || typeof description !== 'string') {
        res.status(400).json({ success: false, error: 'description is required' })
        return
      }

      const store = getStore()
      const taskPriority = parseTaskPriority(priority)
      const title = description.length > 47 ? description.slice(0, 47) + '...' : description

      const task: Task = {
        id: crypto.randomUUID(),
        title,
        description,
        priority: taskPriority,
        status: 'pending',
        createdAt: new Date().toISOString(),
        retryCount: 0,
      }

      store.saveTask(task)

      // 启动后台进程执行任务
      const pid = spawnTaskProcess({ taskId: task.id })

      res.json({ success: true, data: { task, pid } })
    } catch (err) {
      logger.error('Failed to create task', err)
      res.status(500).json({ success: false, error: 'Failed to create task' })
    }
  })

  // POST /api/tasks/:id/stop - 停止任务
  app.post('/api/tasks/:id/stop', (req: Request<{ id: string }>, res: Response) => {
    try {
      const result = stopTask(req.params.id)
      if (!result.success) {
        res.status(400).json({ success: false, error: result.error })
        return
      }
      res.json({ success: true, data: { task: result.task } })
    } catch (err) {
      logger.error('Failed to stop task', err)
      res.status(500).json({ success: false, error: 'Failed to stop task' })
    }
  })

  // POST /api/tasks/:id/resume - 恢复任务
  app.post('/api/tasks/:id/resume', (req: Request<{ id: string }>, res: Response) => {
    try {
      const pid = resumeTask(req.params.id)
      if (pid === null) {
        res
          .status(400)
          .json({
            success: false,
            error: 'Task cannot be resumed (not found, still running, or already completed)',
          })
        return
      }
      const task = getTask(req.params.id)
      res.json({ success: true, data: { task, pid } })
    } catch (err) {
      logger.error('Failed to resume task', err)
      res.status(500).json({ success: false, error: 'Failed to resume task' })
    }
  })

  // DELETE /api/tasks/:id - 删除任务
  app.delete('/api/tasks/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
      const result = deleteTask(req.params.id)
      if (!result.success) {
        res.status(400).json({ success: false, error: result.error })
        return
      }
      res.json({ success: true, data: { task: result.task } })
    } catch (err) {
      logger.error('Failed to delete task', err)
      res.status(500).json({ success: false, error: 'Failed to delete task' })
    }
  })

  // POST /api/tasks/:id/complete - 完成任务
  app.post('/api/tasks/:id/complete', (req: Request<{ id: string }>, res: Response) => {
    try {
      const result = completeTask(req.params.id)
      if (!result.success) {
        res.status(400).json({ success: false, error: result.error })
        return
      }
      res.json({ success: true, data: { task: result.task } })
    } catch (err) {
      logger.error('Failed to complete task', err)
      res.status(500).json({ success: false, error: 'Failed to complete task' })
    }
  })

  // GET /api/tasks/:id/logs - 获取任务执行日志
  app.get('/api/tasks/:id/logs', (req: Request<{ id: string }>, res: Response) => {
    try {
      const task = getTask(req.params.id)
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' })
        return
      }

      const logPath = getLogPath(task.id)
      if (!existsSync(logPath)) {
        res.json({ success: true, data: { logs: '' } })
        return
      }

      const tail = parseInt(req.query.tail as string)
      const content = readFileSync(logPath, 'utf-8')

      if (tail > 0) {
        const lines = content.split('\n')
        const tailLines = lines.slice(-tail).join('\n')
        res.json({ success: true, data: { logs: tailLines } })
        return
      }

      res.json({ success: true, data: { logs: content } })
    } catch (err) {
      logger.error('Failed to get logs', err)
      res.status(500).json({ success: false, error: 'Failed to get logs' })
    }
  })

  // GET /api/tasks/:id/result - 获取任务结果 Markdown
  app.get('/api/tasks/:id/result', (req: Request<{ id: string }>, res: Response) => {
    try {
      const task = getTask(req.params.id)
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' })
        return
      }

      const resultPath = getOutputPath(task.id)
      if (!existsSync(resultPath)) {
        res.json({ success: true, data: { content: '' } })
        return
      }

      const content = readFileSync(resultPath, 'utf-8')
      res.json({ success: true, data: { content } })
    } catch (err) {
      logger.error('Failed to get result', err)
      res.status(500).json({ success: false, error: 'Failed to get result' })
    }
  })

  // ============ Static Files ============

  // Serve static files from public directory
  app.use(express.static(publicDir))

  // Fallback to index.html for SPA routing (Express 5 syntax)
  app.use((_req: Request, res: Response) => {
    res.sendFile(join(publicDir, 'index.html'))
  })

  // ============ Start Server ============

  app.listen(port, host, () => {
    const url = `http://${host}:${port}`
    logger.info(`Server started at ${url}`)
    console.log(`\n  Workflow Visualizer running at: ${url}\n`)

    // Auto open browser
    if (options.open) {
      import('child_process').then(({ exec }) => {
        const cmd =
          process.platform === 'darwin'
            ? 'open'
            : process.platform === 'win32'
              ? 'start'
              : 'xdg-open'
        exec(`${cmd} ${url}`)
      })
    }
  })
}
