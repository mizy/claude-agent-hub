/**
 * Express HTTP Server
 *
 * Server initialization, middleware, and static file serving.
 * Route definitions are in routes.ts.
 */

import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from '../shared/logger.js'
import { registerRoutes } from './routes.js'
import { registerChatRoutes } from './chatRoutes.js'

const logger = createLogger('server')

const DEFAULT_PORT = 3000

// Get the public directory path
// When bundled by tsup, the code is in dist/cli/index.js
// The public folder is at dist/server/public
const currentFile = fileURLToPath(import.meta.url)
const currentDir = dirname(currentFile)
const publicDir = join(currentDir, '..', 'server', 'public')

export interface ServerOptions {
  port?: number
  host?: string
  open?: boolean
}

/**
 * Start the HTTP server
 */
export function startServer(options: ServerOptions = {}): void {
  const port = options.port || DEFAULT_PORT
  const host = options.host || 'localhost'

  const app = express()

  // Middleware
  app.use(express.json())

  // Localhost-only: reject requests from non-loopback addresses
  app.use((req, res, next) => {
    const ip = req.socket.remoteAddress || ''
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
    if (!isLoopback) {
      res.status(403).json({ error: 'Forbidden: dashboard is localhost-only' })
      return
    }
    next()
  })

  // CORS: restrict to localhost origins only
  app.use((req, res, next) => {
    const origin = req.headers.origin || ''
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.header('Access-Control-Allow-Origin', origin)
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  // API Routes
  registerRoutes(app)
  registerChatRoutes(app)

  // Static files
  app.use(express.static(publicDir))

  // SPA fallback
  app.use((_req, res) => {
    res.sendFile(join(publicDir, 'index.html'))
  })

  // Start
  app.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host
    const url = `http://${displayHost}:${port}`
    logger.info(`Server started at ${url}`)
    import('chalk')
      .then(({ default: chalk }) => {
        console.log(chalk.green(`\n  ✓ Dashboard: ${url}\n`))
      })
      .catch(() => {
        console.log(`\n  ✓ Dashboard: ${url}\n`)
      })

    // Auto open browser
    if (options.open) {
      import('child_process')
        .then(({ exec }) => {
          const cmd =
            process.platform === 'darwin'
              ? 'open'
              : process.platform === 'win32'
                ? 'start'
                : 'xdg-open'
          exec(`${cmd} ${url}`)
        })
        .catch(() => {
          /* browser open is best-effort */
        })
    }
  })
}
