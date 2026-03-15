import type { Express, Request, Response } from 'express'
import { createLogger } from '../../shared/logger.js'
import { loadConfig, saveConfig } from '../../config/loadConfig.js'

const logger = createLogger('server-routes')

/** Replace secret fields with masked placeholder for API responses */
function maskSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const SECRET_KEYS = new Set(['appSecret', 'botToken'])
  function mask(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(mask)
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = SECRET_KEYS.has(k) && typeof v === 'string' && v.length > 0 ? '***' : mask(v)
    }
    return result
  }
  return mask(config) as Record<string, unknown>
}

export function registerConfigRoutes(app: Express): void {
  app.get('/api/config', async (_req: Request, res: Response) => {
    try {
      const config = await loadConfig()
      res.json(maskSecrets(config as unknown as Record<string, unknown>))
    } catch (err) {
      logger.error('Failed to get config', err)
      res.status(500).json({ error: 'Failed to get config' })
    }
  })

  app.put('/api/config', async (req: Request, res: Response) => {
    try {
      const incoming = req.body as Record<string, unknown>
      // Merge: keep original secret values when frontend sends masked placeholder '***'
      const current = await loadConfig()
      const SECRET_KEYS = new Set(['appSecret', 'botToken'])
      function mergeSecrets(src: unknown, orig: unknown): unknown {
        if (src === null || typeof src !== 'object' || orig === null || typeof orig !== 'object') return src
        if (Array.isArray(src)) return src
        const result: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
          if (SECRET_KEYS.has(k) && v === '***') {
            result[k] = (orig as Record<string, unknown>)[k]
          } else if (typeof v === 'object' && v !== null) {
            result[k] = mergeSecrets(v, (orig as Record<string, unknown>)[k] ?? {})
          } else {
            result[k] = v
          }
        }
        return result
      }
      await saveConfig(mergeSecrets(incoming, current as unknown) as Record<string, unknown>)
      res.json({ success: true })
    } catch (err) {
      logger.error('Failed to save config', err)
      res.status(500).json({ error: 'Failed to save config' })
    }
  })
}
