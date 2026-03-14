/**
 * Upload rendered workflow graph to Lark and return image_key
 */

import type * as Lark from '@larksuiteoapi/node-sdk'
import type { Workflow, WorkflowInstance } from '../../types/workflow.js'
import { renderWorkflowGraph } from './renderWorkflowGraph.js'
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
  instance: WorkflowInstance
): Promise<string | null> {
  try {
    const result = await renderWorkflowGraph(workflow, instance)
    if (!result) return null

    const imageKey = await uploadLarkImage(larkClient, result.buffer)
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
