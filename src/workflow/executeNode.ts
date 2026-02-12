/**
 * 执行 Workflow 节点
 * 作为 NodeWorker 的 processor 使用
 */

import { markNodeRunning, markNodeFailed, handleNodeResult } from './index.js'
import { getWorkflow, getInstance, saveInstance } from '../store/WorkflowStore.js'
import { getTask, updateTask } from '../store/TaskStore.js'
import { createLogger, logError as logErrorHelper } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'
import { logNodeStarted, logNodeCompleted, logNodeFailed } from './logNodeExecution.js'
import { executeNodeByType } from './nodeTypeHandlers.js'
import type { NodeJobData, NodeJobResult, WorkflowNode } from './types.js'

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
 * Send Lark notification for autoWait pause (fire-and-forget)
 */
async function notifyAutoWaitPause(
  workflowName: string,
  nodeName: string,
  taskId?: string,
  nodeDescription?: string
): Promise<void> {
  try {
    const { loadConfig } = await import('../config/loadConfig.js')
    const config = await loadConfig()
    const larkChatId = config.notify?.lark?.chatId
    if (!larkChatId || !taskId) {
      // Fallback to webhook if no chat ID
      const webhookUrl = config.notify?.lark?.webhookUrl
      if (!webhookUrl) return

      const { sendReviewNotification } = await import('../notify/index.js')
      await sendReviewNotification({
        webhookUrl,
        taskTitle: workflowName,
        workflowName,
        workflowId: '',
        instanceId: '',
        nodeId: '',
        nodeName: `[autoWait] ${nodeName}`,
      })
      logger.info(`Sent autoWait notification for node ${nodeName}`)
      return
    }

    const { sendLarkCardViaApi, buildAutoWaitCard } = await import('../notify/index.js')
    const card = buildAutoWaitCard({
      taskId,
      taskTitle: workflowName,
      nodeName,
      nodeDescription,
    })
    await sendLarkCardViaApi(larkChatId, card)
    logger.info(`Sent autoWait card for node ${nodeName}`)
  } catch (err) {
    logger.warn(`Failed to send autoWait notification: ${err}`)
  }
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

  // 检查 autoWait：执行前自动暂停
  if (shouldAutoWait(node)) {
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
    notifyAutoWaitPause(workflow.name, node.name, taskId, node.description || node.task?.prompt).catch(() => {})

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

  try {
    const result = await executeNodeByType(node, workflow, instance)

    const durationMs = Date.now() - nodeStartTime
    const costUsd = result.costUsd

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
    const errorMessage = formatErrorMessage(error)
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
