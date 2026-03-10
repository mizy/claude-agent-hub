/**
 * 执行 Workflow 节点
 * 作为 NodeWorker 的 processor 使用
 */

import { handleNodeResult } from './engine/WorkflowExecution.js'
import { markNodeRunning, markNodeFailed } from './engine/StateManager.js'
import { getWorkflow, getInstance, saveInstance } from '../store/WorkflowStore.js'
import { getTask, updateTask } from '../store/TaskStore.js'
import { createLogger, logError as logErrorHelper } from '../shared/logger.js'
import { getErrorMessage, isError, getErrorStack } from '../shared/assertError.js'
import { logNodeStarted, logNodeCompleted, logNodeFailed } from './logNodeExecution.js'
import { executeNodeByType } from './nodeTypeHandlers.js'
import { createRootSpan, createChildSpan, endSpan } from '../store/createSpan.js'
import { appendSpan } from '../store/TraceStore.js'
import { sendAutoWaitPause } from '../notification/index.js'
import type { NodeJobData, NodeJobResult, WorkflowNode } from './types.js'
import type { TraceContext } from '../types/trace.js'

const logger = createLogger('execute-node')

/** High-risk keywords that trigger auto-pause if found in node prompt */
const HIGH_RISK_KEYWORDS = [
  'git push',
  'npm publish',
  'yarn publish',
  'pnpm publish',
  'deploy',
  'rm -rf',
  'drop table',
  'drop database',
  'force push',
  'production',
]

/**
 * Check if a node should auto-pause before execution.
 * Returns true if node has autoWait flag or its prompt contains high-risk keywords.
 */
function shouldAutoWait(node: WorkflowNode): boolean {
  // Explicit autoWait flag
  if (node.autoWait) return true

  // Auto-detect high-risk content in task node prompts
  if (node.task?.prompt) {
    const promptLower = node.task.prompt.toLowerCase()
    return HIGH_RISK_KEYWORDS.some(keyword => promptLower.includes(keyword))
  }

  return false
}

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

  // 检查 autoWait：执行前自动暂停（跳过已被用户 approve 的节点）
  const nodeState = instance.nodeStates[nodeId]
  if (shouldAutoWait(node) && !nodeState?.autoWaitApproved) {
    const taskId = instance.variables?.taskId as string | undefined
    const reason = `autoWait: ${node.name}`
    logger.info(`Node ${nodeId} (${node.name}) has autoWait, pausing before execution`)

    // Pause instance and task
    const inst = getInstance(instanceId)
    if (inst && inst.status === 'running') {
      inst.status = 'paused'
      inst.pausedAt = new Date().toISOString()
      inst.pauseReason = reason
      saveInstance(inst)
    }
    if (taskId) {
      const task = getTask(taskId)
      if (task && task.status === 'developing') {
        updateTask(taskId, { status: 'paused' })
      }
    }

    // Send Lark notification asynchronously (fire-and-forget)
    sendAutoWaitPause({
      workflowName: workflow.name,
      nodeName: node.name,
      taskId,
      nodeDescription: node.description || node.task?.prompt,
    }).catch(e => logger.debug(`Auto-wait-pause notify failed: ${e}`))

    // Return special result — the NodeWorker will re-queue this node
    // when the user resumes (the node stays in pending/ready state)
    return {
      success: false,
      error: 'AUTO_WAIT_PAUSED',
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

  // Create trace context for this node (traceId = taskId)
  let traceCtx: TraceContext | undefined
  if (taskId) {
    const spanAttrs = {
      'task.id': taskId,
      'workflow.id': workflowId,
      'instance.id': instanceId,
      'node.id': nodeId,
      'node.type': node.type,
      'node.name': node.name,
      'node.attempt': currentAttempt,
      'node.agent': node.task?.agent,
    }

    // Reconstruct workflow span from instance variables to create child span
    const workflowSpanData = instance.variables?._traceWorkflowSpan as
      | { traceId: string; spanId: string; name: string; kind: string; startTime: number; status: string; attributes: Record<string, unknown> }
      | undefined

    let nodeSpan
    if (workflowSpanData) {
      // Create as child of workflow span (only traceId + spanId needed for parent linkage)
      nodeSpan = createChildSpan(
        { traceId: workflowSpanData.traceId, spanId: workflowSpanData.spanId } as import('../types/trace.js').Span,
        `node:${node.name}`, 'node', spanAttrs
      )
    } else {
      // Fallback: create as root span (e.g. resumed tasks without trace data)
      nodeSpan = createRootSpan(taskId, `node:${node.name}`, 'node', spanAttrs)
    }

    traceCtx = { traceId: taskId, taskId, currentSpan: nodeSpan }
    appendSpan(taskId, nodeSpan)
  }

  try {
    const result = await executeNodeByType(node, workflow, instance, traceCtx)

    const durationMs = Date.now() - nodeStartTime
    const costUsd = result.costUsd

    // End node span
    if (traceCtx) {
      const finished = endSpan(traceCtx.currentSpan, result.success ? undefined : {
        error: { message: result.error || `Node '${node.name}' (${nodeId}) failed` },
      })
      if (costUsd != null) {
        finished.cost = { amount: costUsd, currency: 'USD' }
      }
      appendSpan(taskId!, finished)
    }

    if (result.success) {
      // Check if node was reset to pending while we were running (loop-back race condition).
      // e.g. lark-notify's resetLoopPath ran while analyze_holdings was still executing.
      // Discarding the stale result prevents the node from being left in 'done' state
      // when it should be 'pending' for the next loop cycle.
      const currentState = getInstance(instanceId)?.nodeStates[nodeId]
      if (currentState?.status === 'pending' || currentState?.status === 'ready') {
        logger.warn(
          `Node ${nodeId} was reset to '${currentState.status}' while running — discarding stale result`
        )
        return { success: true, output: result.output, nextNodes: [] }
      }

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

      const errorDetail = result.error || `Node '${node.name}' (${nodeId}) failed with no error message`

      logNodeFailed({
        taskId,
        workflowId,
        instanceId,
        nodeId,
        node,
        error: errorDetail,
        attempt: currentAttempt,
        willRetry,
      })

      await markNodeFailed(instanceId, nodeId, errorDetail)
      return {
        success: false,
        error: errorDetail,
      }
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error)

    // End node span with error
    if (traceCtx) {
      const finished = endSpan(traceCtx.currentSpan, {
        error: {
          message: errorMessage,
          stack: getErrorStack(error),
        },
      })
      appendSpan(taskId!, finished)
    }

    // 使用增强的错误日志记录，包含完整上下文
    logErrorHelper(logger, `Node ${nodeId} failed`, isError(error) ? error : errorMessage, {
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
