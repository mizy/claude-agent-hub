/**
 * API route definitions
 * Registers all REST API endpoints on the Express app
 */

import type { Express, Request, Response } from 'express'
import { existsSync, readFileSync } from 'fs'
import { createLogger } from '../shared/logger.js'
import {
  getAllTasks,
  getTask,
  getTaskWorkflow,
  getTaskInstance,
  getExecutionTimeline,
  getLogPath,
  getOutputPath,
  stopTask,
  deleteTask,
  completeTask,
  pauseTask,
  injectNode,
} from '../task/index.js'
import {
  getRunningTasks,
  getQueuedTasks,
  getTodaySummary,
  getRecentCompleted,
} from '../report/SummaryDataCollector.js'
import {
  getTrace,
  listTraces,
  querySlowSpans,
  getErrorChain,
} from '../store/TraceStore.js'
import { addTaskMessage, getAllTaskMessages } from '../store/TaskMessageStore.js'
import { resumeTask, resumeFailedTask } from '../task/resumeTask.js'
import { resumePausedTask } from '../task/index.js'
import { spawnTaskProcess } from '../task/spawnTask.js'
import { createTaskWithFolder } from '../task/createTaskWithFolder.js'

const logger = createLogger('server-routes')

/**
 * Register all API routes on the Express app
 */
export function registerRoutes(app: Express): void {
  registerSummaryRoutes(app)
  registerTaskRoutes(app)
  registerTaskActionRoutes(app)
  registerTraceRoutes(app)
}

// ============ Summary ============

function registerSummaryRoutes(app: Express): void {
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
}

// ============ Task CRUD ============

function registerTaskRoutes(app: Express): void {
  // GET /api/tasks - task list
  app.get('/api/tasks', (_req: Request, res: Response) => {
    try {
      const tasks = getAllTasks()
      tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      res.json(tasks)
    } catch (err) {
      logger.error('Failed to get tasks', err)
      res.status(500).json({ error: 'Failed to get tasks' })
    }
  })

  // GET /api/tasks/:id - task detail with workflow and instance
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

      res.json({ task, workflow, instance })
    } catch (err) {
      logger.error('Failed to get task', err)
      res.status(500).json({ error: 'Failed to get task' })
    }
  })

  // GET /api/tasks/:id/timeline
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

  // GET /api/tasks/:id/logs
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

  // GET /api/tasks/:id/result
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
}

// ============ Task Actions ============

function registerTaskActionRoutes(app: Express): void {
  // POST /api/tasks - create new task
  app.post('/api/tasks', (req: Request, res: Response) => {
    try {
      const { description, priority } = req.body

      if (!description || typeof description !== 'string') {
        res.status(400).json({ success: false, error: 'description is required' })
        return
      }

      const task = createTaskWithFolder({ description, priority })
      const pid = spawnTaskProcess({ taskId: task.id })

      res.json({ success: true, data: { task, pid } })
    } catch (err) {
      logger.error('Failed to create task', err)
      res.status(500).json({ success: false, error: 'Failed to create task' })
    }
  })

  // POST /api/tasks/:id/stop
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

  // POST /api/tasks/:id/resume
  app.post('/api/tasks/:id/resume', async (req: Request<{ id: string }>, res: Response) => {
    try {
      const task = getTask(req.params.id)
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' })
        return
      }

      if (task.status === 'paused') {
        const result = resumePausedTask(req.params.id)
        if (!result.success) {
          res.status(400).json({ success: false, error: result.error })
          return
        }
        res.json({ success: true, data: { task: result.task } })
      } else if (task.status === 'failed') {
        const result = await resumeFailedTask(req.params.id)
        if (!result.success) {
          res.status(400).json({ success: false, error: result.error })
          return
        }
        const updatedTask = getTask(req.params.id)
        res.json({ success: true, data: { task: updatedTask, pid: result.pid, mode: result.mode } })
      } else {
        const pid = resumeTask(req.params.id)
        if (pid === null) {
          res.status(400).json({
            success: false,
            error: 'Task cannot be resumed (still running or already completed)',
          })
          return
        }
        const updatedTask = getTask(req.params.id)
        res.json({ success: true, data: { task: updatedTask, pid } })
      }
    } catch (err) {
      logger.error('Failed to resume task', err)
      res.status(500).json({ success: false, error: 'Failed to resume task' })
    }
  })

  // DELETE /api/tasks/:id
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

  // POST /api/tasks/:id/pause
  app.post('/api/tasks/:id/pause', (req: Request<{ id: string }>, res: Response) => {
    try {
      const task = getTask(req.params.id)
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' })
        return
      }
      const { reason } = req.body || {}
      const result = pauseTask(req.params.id, reason)
      if (!result.success) {
        res.status(400).json({ success: false, error: result.error })
        return
      }
      res.json({ success: true, data: { task: result.task } })
    } catch (err) {
      logger.error('Failed to pause task', err)
      res.status(500).json({ success: false, error: 'Failed to pause task' })
    }
  })

  // POST /api/tasks/:id/message
  app.post('/api/tasks/:id/message', (req: Request<{ id: string }>, res: Response) => {
    try {
      const task = getTask(req.params.id)
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' })
        return
      }

      const { content } = req.body
      if (!content || typeof content !== 'string') {
        res.status(400).json({ success: false, error: 'content is required' })
        return
      }

      const message = addTaskMessage(req.params.id, content, 'dashboard')
      res.json({ success: true, data: { message } })
    } catch (err) {
      logger.error('Failed to send message', err)
      res.status(500).json({ success: false, error: 'Failed to send message' })
    }
  })

  // GET /api/tasks/:id/messages
  app.get('/api/tasks/:id/messages', (req: Request<{ id: string }>, res: Response) => {
    try {
      const task = getTask(req.params.id)
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' })
        return
      }

      const messages = getAllTaskMessages(req.params.id)
      res.json({ success: true, data: { messages } })
    } catch (err) {
      logger.error('Failed to get messages', err)
      res.status(500).json({ success: false, error: 'Failed to get messages' })
    }
  })

  // POST /api/tasks/:id/inject-node
  app.post('/api/tasks/:id/inject-node', (req: Request<{ id: string }>, res: Response) => {
    try {
      const task = getTask(req.params.id)
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' })
        return
      }
      const { prompt, persona } = req.body
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ success: false, error: 'prompt is required' })
        return
      }

      const result = injectNode(req.params.id, prompt, persona)
      if (!result.success) {
        res.status(400).json({ success: false, error: result.error })
        return
      }
      res.json({ success: true, data: { nodeId: result.nodeId } })
    } catch (err) {
      logger.error('Failed to inject node', err)
      res.status(500).json({ success: false, error: 'Failed to inject node' })
    }
  })

  // POST /api/tasks/:id/complete
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
}

// ============ Trace API ============

function registerTraceRoutes(app: Express): void {
  // GET /api/tasks/:id/traces
  app.get('/api/tasks/:id/traces', (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params
      const task = getTask(id)
      if (!task) {
        res.status(404).json({ error: 'Task not found' })
        return
      }

      const traceIds = listTraces(id)
      const traces = traceIds.map(traceId => getTrace(id, traceId)).filter(Boolean)
      res.json(traces)
    } catch (err) {
      logger.error('Failed to get traces', err)
      res.status(500).json({ error: 'Failed to get traces' })
    }
  })

  // GET /api/tasks/:id/traces/:traceId
  app.get(
    '/api/tasks/:id/traces/:traceId',
    (req: Request<{ id: string; traceId: string }>, res: Response) => {
      try {
        const { id, traceId } = req.params
        const trace = getTrace(id, traceId)
        if (!trace) {
          res.status(404).json({ error: 'Trace not found' })
          return
        }
        res.json(trace)
      } catch (err) {
        logger.error('Failed to get trace', err)
        res.status(500).json({ error: 'Failed to get trace' })
      }
    }
  )

  // GET /api/tasks/:id/traces/slow
  app.get('/api/tasks/:id/traces/slow', (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params
      const minMs = parseInt(req.query.minMs as string) || 1000
      const limit = parseInt(req.query.limit as string) || 20
      const spans = querySlowSpans(id, { minDurationMs: minMs, limit })
      res.json(spans)
    } catch (err) {
      logger.error('Failed to query slow spans', err)
      res.status(500).json({ error: 'Failed to query slow spans' })
    }
  })

  // GET /api/tasks/:id/traces/errors
  app.get('/api/tasks/:id/traces/errors', (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params
      const traceIds = listTraces(id)
      const errorChains: { spanId: string; chain: ReturnType<typeof getErrorChain> }[] = []

      for (const traceId of traceIds) {
        const trace = getTrace(id, traceId)
        if (!trace) continue
        for (const span of trace.spans) {
          if (span.status === 'error') {
            errorChains.push({ spanId: span.spanId, chain: getErrorChain(id, span.spanId) })
          }
        }
      }

      res.json(errorChains)
    } catch (err) {
      logger.error('Failed to get error chains', err)
      res.status(500).json({ error: 'Failed to get error chains' })
    }
  })
}
