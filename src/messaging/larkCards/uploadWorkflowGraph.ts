/**
 * Upload rendered workflow graph to Lark and return image_key.
 *
 * Rendering strategy (in order):
 * 1. Playwright — screenshots the dashboard's MMEditor canvas (best quality, matches dashboard UI)
 * 2. @napi-rs/canvas — fallback if dashboard is not running
 */

import type * as Lark from '@larksuiteoapi/node-sdk'
import type { Workflow, WorkflowInstance } from '../../types/workflow.js'
import { renderWorkflowGraph } from './renderWorkflowGraph.js'
import { renderWorkflowGraphViaPlaywright, isDashboardAccessible } from './renderWorkflowGraphViaPlaywright.js'
import { uploadLarkImage } from '../sendLarkNotify.js'
import { createLogger } from '../../shared/logger.js'

const logger = createLogger('upload-workflow-graph')

/**
 * Render workflow DAG as PNG and upload to Lark.
 * Returns image_key on success, null on failure or if graph is too small.
 */
export async function uploadWorkflowGraphToLark(
  larkClient: Lark.Client,
  workflow: Workflow,
  instance: WorkflowInstance,
  taskId?: string
): Promise<string | null> {
  try {
    let buffer: Buffer | null = null

    // Try Playwright (dashboard MMEditor) first when taskId is available
    if (taskId) {
      const dashboardUp = await isDashboardAccessible()
      if (dashboardUp) {
        buffer = await renderWorkflowGraphViaPlaywright(taskId)
        if (buffer) {
          logger.debug(`Using Playwright render for task ${taskId}`)
        }
      }
    }

    // Fallback to @napi-rs/canvas
    if (!buffer) {
      const result = await renderWorkflowGraph(workflow, instance)
      if (!result) return null
      buffer = result.buffer
      logger.debug(`Using canvas render for workflow graph`)
    }

    const imageKey = await uploadLarkImage(larkClient, buffer)
    if (!imageKey) {
      logger.warn('Failed to upload workflow graph image to Lark')
      return null
    }
    return imageKey
  } catch (err) {
    logger.warn(`uploadWorkflowGraphToLark failed: ${err}`)
    return null
  }
}
