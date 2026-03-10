import type { Express, Request, Response } from 'express'
import { createLogger } from '../../shared/logger.js'
import { getTask } from '../../task/index.js'
import {
  getTrace,
  listTraces,
  querySlowSpans,
  getErrorChain,
} from '../../store/TraceStore.js'

const logger = createLogger('server-routes')

export function registerTraceRoutes(app: Express): void {
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
}
