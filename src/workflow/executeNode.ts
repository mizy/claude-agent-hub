/**
 * 执行 Workflow 节点
 * 作为 NodeWorker 的 processor 使用
 */

import { invokeClaudeCode } from '../claude/invokeClaudeCode.js'
import { buildExecuteNodePrompt } from '../prompts/index.js'
import { appendConversation, appendExecutionLog } from '../store/TaskLogStore.js'
import { BUILTIN_PERSONAS, getBuiltinPersona } from '../persona/builtinPersonas.js'
import { personaNeedsMcp } from '../persona/personaMcpConfig.js'
import type { PersonaConfig } from '../types/persona.js'
import {
  getWorkflow,
  getInstance,
  markNodeRunning,
  markNodeFailed,
  handleNodeResult,
} from './index.js'
import { updateInstanceVariables } from '../store/WorkflowStore.js'
import { createLogger } from '../shared/logger.js'
import { loadConfig } from '../config/loadConfig.js'
import { sendReviewNotification } from '../notify/sendLarkNotify.js'
import {
  executeDelayNode,
  executeScheduleNode,
  executeSwitchNode,
  executeAssignNode,
  executeScriptNode,
  executeLoopNode,
  executeForeachNode,
} from './engine/executeNewNodes.js'
import { logNodeStarted, logNodeCompleted, logNodeFailed } from './logNodeExecution.js'
import type {
  NodeJobData,
  NodeJobResult,
  Workflow,
  WorkflowNode,
  WorkflowInstance,
  EvalContext,
} from '../workflow/types.js'

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
    logger.error(`Node ${nodeId} failed:`, errorMessage)

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

/**
 * 根据节点类型执行
 */
async function executeNodeByType(
  node: WorkflowNode,
  workflow: Workflow,
  instance: WorkflowInstance
): Promise<{ success: boolean; output?: unknown; error?: string }> {
  switch (node.type) {
    case 'start':
    case 'end':
      // 控制节点直接完成
      return { success: true }

    case 'task':
      return executeTaskNode(node, workflow, instance)

    case 'parallel':
      // 并行网关直接完成
      return { success: true }

    case 'join':
      // Join 网关在 WorkflowEngine 中处理
      return { success: true }

    case 'condition':
      // 条件节点在边的 condition 中处理
      return { success: true }

    case 'human':
      // 人工节点需要等待审批
      logger.info(`Human node ${node.id} waiting for approval`)

      // 发送飞书通知
      try {
        const config = await loadConfig()
        const webhookUrl = config.notify?.lark?.webhookUrl

        if (webhookUrl) {
          await sendReviewNotification({
            webhookUrl,
            taskTitle: workflow.name,
            workflowName: workflow.name,
            workflowId: workflow.id,
            instanceId: instance.id,
            nodeId: node.id,
            nodeName: node.name,
          })
          logger.info(`Sent Lark notification for human node ${node.id}`)
        } else {
          logger.warn('Lark webhook URL not configured, skipping notification')
        }
      } catch (notifyError) {
        // 通知失败不影响节点执行
        logger.error(`Failed to send Lark notification: ${notifyError}`)
      }

      return {
        success: false,
        error: 'WAITING_FOR_APPROVAL',
      }

    // ============ 新节点类型 ============

    case 'delay': {
      const result = executeDelayNode(node, instance)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      // 返回延迟信息，供后续处理
      return {
        success: true,
        output: { delayMs: result.delayMs },
      }
    }

    case 'schedule': {
      const result = executeScheduleNode(node, instance)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      // 返回等待时间
      return {
        success: true,
        output: { waitUntil: result.waitUntil?.toISOString() },
      }
    }

    case 'switch': {
      const context = buildEvalContext(instance)
      const result = executeSwitchNode(node, instance, context)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      // 返回目标节点
      return {
        success: true,
        output: { targetNode: result.targetNode },
      }
    }

    case 'assign': {
      const context = buildEvalContext(instance)
      const result = executeAssignNode(node, instance, context)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      // 更新实例变量
      await updateInstanceVariables(instance.id, result.updates)
      return {
        success: true,
        output: { updated: Object.keys(result.updates) },
      }
    }

    case 'script': {
      const context = buildEvalContext(instance)
      const result = executeScriptNode(node, instance, context)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      // 如果有输出变量，更新实例变量
      if (result.outputVar) {
        await updateInstanceVariables(instance.id, {
          [result.outputVar]: result.result,
        })
      }
      return {
        success: true,
        output: result.result,
      }
    }

    case 'loop': {
      const context = buildEvalContext(instance)
      const result = executeLoopNode(node, instance, context)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      // 返回循环状态
      return {
        success: true,
        output: {
          shouldContinue: result.shouldContinue,
          loopVar: result.loopVar,
          loopValue: result.loopValue,
          bodyNodes: result.bodyNodes,
        },
      }
    }

    case 'foreach': {
      const context = buildEvalContext(instance)
      const result = executeForeachNode(node, instance, context)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      // 返回遍历信息
      return {
        success: true,
        output: {
          items: result.items,
          itemVar: result.itemVar,
          indexVar: result.indexVar,
          bodyNodes: result.bodyNodes,
          mode: result.mode,
        },
      }
    }

    default:
      return {
        success: false,
        error: `Unknown node type: ${node.type}`,
      }
  }
}

/**
 * 执行 Task 节点
 */
async function executeTaskNode(
  node: WorkflowNode,
  workflow: Workflow,
  instance: WorkflowInstance
): Promise<{
  success: boolean
  output?: unknown
  error?: string
  sessionId?: string
  costUsd?: number
}> {
  if (!node.task) {
    return { success: false, error: 'Task config missing' }
  }

  const { persona: personaName, prompt: taskPrompt } = node.task

  // 获取 persona (找不到会回退到默认 Pragmatist)
  const persona = resolvePersona(personaName)

  // 构建上下文
  const context = buildNodeContext(instance)

  // 构建 prompt
  const prompt = buildExecuteNodePrompt(persona, workflow, node.name, taskPrompt, context)

  // 根据角色决定是否启用 MCP
  // 不需要外部集成的角色禁用 MCP，加速启动
  const disableMcp = !personaNeedsMcp(persona.name)

  // 获取 taskId 用于日志写入
  const logTaskId = instance.variables?.taskId as string | undefined

  // 复用已有 Claude 会话（加速连续任务）
  // 暂时禁用会话复用以排查问题
  // const existingSessionId = instance.variables?.claudeSessionId as string | undefined
  const existingSessionId = undefined

  // 从配置读取模型
  const config = await loadConfig()
  const model = config.claude?.model || 'opus'

  const result = await invokeClaudeCode({
    prompt,
    mode: 'execute',
    persona,
    stream: true,
    disableMcp,
    sessionId: existingSessionId,
    model,
    timeoutMs: 30 * 60 * 1000, // 30 分钟超时
    onChunk: chunk => {
      // 流式输出到执行日志（原始模式，只清理 ANSI 颜色码）
      if (logTaskId) {
        appendExecutionLog(logTaskId, chunk, { raw: true })
      }
      process.stdout.write(chunk)
    },
  })

  if (!result.ok) {
    return {
      success: false,
      error: result.error.message,
    }
  }

  // 保存 sessionId 供后续节点复用
  const newSessionId = result.value.sessionId
  if (newSessionId && newSessionId !== existingSessionId) {
    await updateInstanceVariables(instance.id, { claudeSessionId: newSessionId })
    logger.debug(`Saved Claude session: ${newSessionId.slice(0, 8)}...`)
  }

  // 记录 AI 对话到任务日志
  const taskId = instance.variables?.taskId as string
  if (taskId) {
    appendConversation(taskId, {
      timestamp: new Date().toISOString(),
      phase: 'executing',
      nodeId: node.id,
      nodeName: node.name,
      prompt: result.value.prompt,
      response: result.value.response,
      durationMs: result.value.durationMs,
      durationApiMs: result.value.durationApiMs,
      costUsd: result.value.costUsd,
    })
  }

  return {
    success: true,
    output: result.value.response,
    sessionId: newSessionId,
    costUsd: result.value.costUsd,
  }
}

/** 默认 Persona 名称 */
const DEFAULT_PERSONA_NAME = 'Pragmatist'

/**
 * 解析 Persona
 *
 * 选择逻辑：
 * 1. 指定具体 persona 名字 → 使用该 persona
 * 2. 空值或 'auto' → 使用默认 Pragmatist
 * 3. 找不到指定的 persona → 回退到默认
 */
function resolvePersona(personaName?: string): PersonaConfig {
  // 默认 persona 一定存在（在 builtinPersonas.ts 中定义）
  const defaultPersona = BUILTIN_PERSONAS[DEFAULT_PERSONA_NAME]!

  // 未指定或 auto，使用默认
  if (!personaName || personaName === 'auto') {
    return defaultPersona
  }

  // 尝试获取指定的 persona
  const persona = getBuiltinPersona(personaName)
  if (persona) {
    return persona
  }

  logger.warn(`Persona "${personaName}" not found, falling back to ${DEFAULT_PERSONA_NAME}`)
  return defaultPersona
}

/**
 * 构建节点执行上下文
 */
function buildNodeContext(instance: WorkflowInstance): string {
  const completedNodes = Object.entries(instance.nodeStates)
    .filter(([, state]) => state.status === 'done')
    .map(([nodeId]) => `- ${nodeId}: ${JSON.stringify(instance.outputs[nodeId] || 'completed')}`)

  if (completedNodes.length === 0) {
    return ''
  }

  return `已完成的节点:\n${completedNodes.join('\n')}`
}

/**
 * 构建表达式求值上下文
 */
function buildEvalContext(instance: WorkflowInstance): EvalContext {
  return {
    outputs: instance.outputs,
    variables: instance.variables,
    loopCount: 0, // 将由具体节点设置
    nodeStates: instance.nodeStates,
  }
}
