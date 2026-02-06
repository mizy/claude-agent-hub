/**
 * 节点类型处理器
 * 处理不同类型节点的执行逻辑
 */

import { invokeBackend } from '../backend/index.js'
import { buildExecuteNodePrompt } from '../prompts/index.js'
import { appendConversation, appendExecutionLog } from '../store/TaskLogStore.js'
import { personaNeedsMcp } from '../persona/personaMcpConfig.js'
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
import { extractStructuredOutput, resolvePersona, buildNodeContext, buildEvalContext } from './nodeResultProcessor.js'
import type { Workflow, WorkflowNode, WorkflowInstance } from './types.js'

const logger = createLogger('node-handlers')

/**
 * 根据节点类型执行
 */
export async function executeNodeByType(
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
      return executeHumanNode(node, workflow, instance)

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
      // 模式 1：多变量赋值（assignments）
      if (result.updates) {
        await updateInstanceVariables(instance.id, result.updates)
        return {
          success: true,
          output: { updated: Object.keys(result.updates) },
        }
      }
      // 模式 2：单输出变量（向后兼容）
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
 * 执行人工审批节点
 */
async function executeHumanNode(
  node: WorkflowNode,
  workflow: Workflow,
  instance: WorkflowInstance
): Promise<{ success: boolean; error?: string }> {
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
  const model = config.backend?.model ?? config.claude?.model ?? 'opus'

  const result = await invokeBackend({
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

  // 尝试从响应中提取结构化 JSON 数据
  const output = extractStructuredOutput(result.value.response)

  return {
    success: true,
    output,
    sessionId: newSessionId,
    costUsd: result.value.costUsd,
  }
}
