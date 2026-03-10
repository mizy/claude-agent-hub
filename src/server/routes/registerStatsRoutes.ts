import type { Express, Request, Response } from 'express'
import { createLogger } from '../../shared/logger.js'
import { getStatsOverview } from '../../statistics/index.js'

const logger = createLogger('server-routes')

export function registerStatsRoutes(app: Express): void {
  app.get('/api/stats', (req: Request, res: Response) => {
    try {
      const force = req.query.force === 'true'
      const overview = getStatsOverview(force)
      res.json(overview)
    } catch (err) {
      logger.error('Failed to get stats', err)
      res.status(500).json({ error: 'Failed to get stats' })
    }
  })

  app.get('/api/stats/chat', (_req: Request, res: Response) => {
    try {
      const overview = getStatsOverview()
      res.json(overview.chat)
    } catch (err) {
      logger.error('Failed to get chat stats', err)
      res.status(500).json({ error: 'Failed to get chat stats' })
    }
  })

  app.get('/api/stats/task', (_req: Request, res: Response) => {
    try {
      const overview = getStatsOverview()
      res.json(overview.task)
    } catch (err) {
      logger.error('Failed to get task stats', err)
      res.status(500).json({ error: 'Failed to get task stats' })
    }
  })

  app.get('/api/stats/lifecycle', (_req: Request, res: Response) => {
    try {
      const overview = getStatsOverview()
      res.json(overview.lifecycle)
    } catch (err) {
      logger.error('Failed to get lifecycle stats', err)
      res.status(500).json({ error: 'Failed to get lifecycle stats' })
    }
  })

  app.get('/api/stats/growth', (_req: Request, res: Response) => {
    try {
      const overview = getStatsOverview()
      res.json(overview.growth)
    } catch (err) {
      logger.error('Failed to get growth stats', err)
      res.status(500).json({ error: 'Failed to get growth stats' })
    }
  })
}
