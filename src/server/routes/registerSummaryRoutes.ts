import type { Express, Request, Response } from 'express'
import { createLogger } from '../../shared/logger.js'
import {
  getRunningTasks,
  getQueuedTasks,
  getTodaySummary,
  getRecentCompleted,
} from '../../report/SummaryDataCollector.js'

const logger = createLogger('server-routes')

export function registerSummaryRoutes(app: Express): void {
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
