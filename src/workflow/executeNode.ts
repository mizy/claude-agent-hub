/**
 * 执行 Workflow 节点
 * 作为 NodeWorker 的 processor 使用
 */

import { markNodeRunning, markNodeFailed, handleNodeResult } from './index.js'
import { getWorkflow, getInstance } from '../store/WorkflowStore.js'
import { createLogger, logError as logErrorHelper } from '../shared/logger.js'
import { logNodeStarted, logNodeCompleted, logNodeFailed } from './logNodeExecution.js'
import { executeNodeByType } from './nodeTypeHandlers.js'
import type { NodeJobData, NodeJobResult } from './types.js'

const logger = createLogger('execute-node')

/**
 * 节点执行处理器
 * 供 NodeWorker 使用
 */
export async function executeNode(data: NodeJobData): Promise<NodeJobResult> {
  const { workflowId, instanceId, nodeId, attempt } = data

  logger.info(`Executing node: ${nodeId} (attempt ${attempt})`)

  const workflow = getWorkflow(workflowId)
  const instance = getInstance(instanceId)

  if (!workflow || !instance) {
    return {
      success: false,
      error: `Workflow or instance not found: ${workflowId}/${instanceId}`,
    }
  }

  const node = workflow.nodes.find(n => n.id === nodeId)
  if (!node) {
    return {
      success: false,
      error: `Node not found: ${nodeId}`,
    }
  }

  // 标记节点运行中
  await markNodeRunning(instanceId, nodeId)

  // 记录节点开始
  const nodeStartTime = Date.now()
  const currentAttempt = instance.nodeStates[nodeId]?.attempts ?? 1
  const taskId = instance.variables?.taskId as string | undefined

  logNodeStarted({
    taskId,
    workflowId,
    instanceId,
    nodeId,
    node,
    attempt: currentAttempt,
  })

  try {
    const result = await executeNodeByType(node, workflow, instance)

    const durationMs = Date.now() - nodeStartTime
    const costUsd = (result as { costUsd?: number }).costUsd

    if (result.success) {
      // 记录节点完成
      logNodeCompleted({
        taskId,
        workflowId,
        instanceId,
        nodeId,
        node,
        durationMs,
        output: result.output,
        costUsd,
      })

      // 处理节点结果，获取下游节点
      const nextNodes = await handleNodeResult(workflowId, instanceId, nodeId, result)

      return {
        success: true,
        output: result.output,
        nextNodes,
      }
    } else {
      // 记录节点失败
      const maxAttempts = node.retry?.maxAttempts ?? 3
      const willRetry = currentAttempt < maxAttempts

      logNodeFailed({
        taskId,
        workflowId,
        instanceId,
        nodeId,
        node,
        error: result.error || 'Unknown error',
        attempt: currentAttempt,
        willRetry,
      })

      await markNodeFailed(instanceId, nodeId, result.error || 'Unknown error')
      return {
        success: false,
        error: result.error,
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    // 使用增强的错误日志记录，包含完整上下文
    logErrorHelper(logger, `Node ${nodeId} failed`, error instanceof Error ? error : errorMessage, {
      workflowId,
      instanceId,
      nodeId,
      attempt,
    })

    // 记录节点失败
    const maxAttempts = node.retry?.maxAttempts ?? 3
    const willRetry = currentAttempt < maxAttempts

    logNodeFailed({
      taskId,
      workflowId,
      instanceId,
      nodeId,
      node,
      error: errorMessage,
      attempt: currentAttempt,
      willRetry,
    })

    await markNodeFailed(instanceId, nodeId, errorMessage)
    return {
      success: false,
      error: errorMessage,
    }
  }
}
