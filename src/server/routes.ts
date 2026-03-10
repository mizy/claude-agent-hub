/**
 * API route definitions
 * Registers all REST API endpoints on the Express app
 */

import type { Express } from 'express'
import { registerSummaryRoutes } from './routes/registerSummaryRoutes.js'
import { registerTaskRoutes } from './routes/registerTaskRoutes.js'
import { registerTraceRoutes } from './routes/registerTraceRoutes.js'
import { registerConfigRoutes } from './routes/registerConfigRoutes.js'
import { registerStatsRoutes } from './routes/registerStatsRoutes.js'

export function registerRoutes(app: Express): void {
  registerSummaryRoutes(app)
  registerTaskRoutes(app)
  registerTraceRoutes(app)
  registerConfigRoutes(app)
  registerStatsRoutes(app)
}
