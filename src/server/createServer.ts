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
} from '../store/index.js'
import {
  getRunningTasks,
  getQueuedTasks,
  getTodaySummary,
  getRecentCompleted,
} from '../report/SummaryDataCollector.js'

import { existsSync } from 'fs'

const logger = createLogger('server')

// Get the public directory path
// When bundled by tsup, the code is in dist/cli/index.js
// The public folder is at dist/server/public
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// Go up from dist/cli to dist, then down to server/public
const publicDir = join(__dirname, '..', 'server', 'public')

export interface ServerOptions {
  port?: number
  host?: string
  open?: boolean
}

/**
 * 启动 HTTP Server
 */
export function startServer(options: ServerOptions = {}): void {
  const port = options.port || 3000
  const host = options.host || 'localhost'

  const app = express()

  // Middleware
  app.use(express.json())

  // CORS for development
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
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
  app.get('/api/tasks/:id', (req: Request, res: Response) => {
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
  app.get('/api/tasks/:id/timeline', (req: Request, res: Response) => {
    try {
      const { id } = req.params
      const timeline = getExecutionTimeline(id)
      res.json(timeline || [])
    } catch (err) {
      logger.error('Failed to get timeline', err)
      res.status(500).json({ error: 'Failed to get timeline' })
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
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
        exec(`${cmd} ${url}`)
      })
    }
  })
}
