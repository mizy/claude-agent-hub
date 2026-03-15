/**
 * Render workflow topology by screenshotting the dashboard's MMEditor canvas.
 * This reuses the exact same rendering as the dashboard (MMEditor + custom node shapes),
 * producing visually consistent results.
 */

import { createLogger } from '../../shared/logger.js'

const logger = createLogger('render-workflow-graph-playwright')

const DEFAULT_DASHBOARD_PORT = 7788
const RENDER_TIMEOUT_MS = 8000

/**
 * Render workflow graph by screenshotting the dashboard task page via Playwright.
 * Returns PNG buffer on success, null on any failure.
 */
export async function renderWorkflowGraphViaPlaywright(
  taskId: string,
  port = DEFAULT_DASHBOARD_PORT
): Promise<Buffer | null> {
  let browser: import('playwright-core').Browser | null = null

  try {
    const { chromium } = await import('playwright-core')

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ deviceScaleFactor: 2 })
    const page = await context.newPage()

    // Set viewport wide enough for the workflow canvas
    await page.setViewportSize({ width: 1400, height: 900 })

    const url = `http://localhost:${port}/#/tasks?id=${taskId}`
    await page.goto(url, { waitUntil: 'networkidle', timeout: RENDER_TIMEOUT_MS })

    // Wait for MMEditor canvas to appear and render
    const canvasSelector = '.ve-editor'
    await page.waitForSelector(canvasSelector, { timeout: RENDER_TIMEOUT_MS })

    // Give MMEditor time to finish layout (dagre + node rendering)
    // Wait for canvas to be stable (no reflows)
    await page.waitForFunction(
      `document.querySelector('.ve-editor')?.offsetHeight > 0`,
      { timeout: RENDER_TIMEOUT_MS }
    )
    await page.waitForTimeout(1200)

    const canvas = page.locator(canvasSelector)
    const buffer = await canvas.screenshot({ type: 'png', scale: 'device' })

    logger.debug(`Workflow graph screenshot captured for task ${taskId}`)
    return Buffer.from(buffer)
  } catch (err) {
    logger.debug(`Playwright render failed for task ${taskId}: ${err}`)
    return null
  } finally {
    await browser?.close()
  }
}

/**
 * Check if the dashboard is accessible at the given port.
 */
export async function isDashboardAccessible(port = DEFAULT_DASHBOARD_PORT): Promise<boolean> {
  try {
    const { default: http } = await import('http')
    return await new Promise<boolean>(resolve => {
      const req = http.get(`http://localhost:${port}/`, { timeout: 1000 }, res => {
        resolve(res.statusCode !== undefined && res.statusCode < 500)
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
    })
  } catch {
    return false
  }
}
