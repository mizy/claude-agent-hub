import type { Express, Request, Response } from 'express'
import { createLogger } from '../../shared/logger.js'
import { loadConfig, saveConfig } from '../../config/loadConfig.js'

const logger = createLogger('server-routes')

export function registerConfigRoutes(app: Express): void {
  app.get('/api/config', async (_req: Request, res: Response) => {
    try {
      const config = await loadConfig()
      res.json(config)
    } catch (err) {
      logger.error('Failed to get config', err)
      res.status(500).json({ error: 'Failed to get config' })
    }
  })

  app.put('/api/config', async (req: Request, res: Response) => {
    try {
      await saveConfig(req.body)
      res.json({ success: true })
    } catch (err) {
      logger.error('Failed to save config', err)
      res.status(500).json({ error: 'Failed to save config' })
    }
  })
}
