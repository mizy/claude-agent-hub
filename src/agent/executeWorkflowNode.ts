/**
 * 执行 Workflow 节点
 * 作为 NodeWorker 的 processor 使用
 */

import { invokeClaudeCode } from '../claude/invokeClaudeCode.js'
import { buildExecuteNodePrompt } from '../prompts/index.js'
import { getStore } from '../store/index.js'
import { appendConversation } from '../store/TaskStore.js'
import {
  getWorkflow,
  getInstance,
  markNodeRunning,
  markNodeDone,
  markNodeFailed,
  handleNodeResult,
  updateInstanceVariables,
} from '../workflow/index.js'
import { createLogger } from '../shared/logger.js'
import { loadConfig } from '../config/loadConfig.js'
import { sendReviewNotification } from '../notify/lark.js'
import {
  executeDelayNode,
  executeScheduleNode,
  executeSwitchNode,
  executeAssignNode,
  executeScriptNode,
  executeLoopNode,
  executeForeachNode,
} from '../workflow/engine/executeNewNodes.js'
import type { NodeJobData, NodeJobResult, Workflow, WorkflowNode, WorkflowInstance, EvalContext } from '../workflow/types.js'
import type { Agent } from '../types/agent.js'

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

  try {
    const result = await executeNodeByType(node, workflow, instance)

    if (result.success) {
      // 处理节点结果，获取下游节点
      const nextNodes = await handleNodeResult(workflowId, instanceId, nodeId, result)

      return {
        success: true,
        output: result.output,
        nextNodes,
      }
    } else {
      await markNodeFailed(instanceId, nodeId, result.error || 'Unknown error')
      return {
        success: false,
        error: result.error,
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Node ${nodeId} failed:`, errorMessage)
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
): Promise<{ success: boolean; output?: unknown; error?: string }> {
  if (!node.task) {
    return { success: false, error: 'Task config missing' }
  }

  const { agent: agentName, prompt: taskPrompt } = node.task

  // 获取 agent
  const agent = resolveAgent(agentName)
  if (!agent) {
    return { success: false, error: `Agent not found: ${agentName}` }
  }

  // 构建上下文
  const context = buildNodeContext(instance)

  // 构建 prompt
  const prompt = buildExecuteNodePrompt(agent, workflow, node.name, taskPrompt, context)

  const result = await invokeClaudeCode({
    prompt,
    mode: 'execute',
    persona: agent.personaConfig,
    stream: true,
  })

  if (!result.ok) {
    return {
      success: false,
      error: result.error.message,
    }
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
    })
  }

  return {
    success: true,
    output: result.value.response,
  }
}

/**
 * 解析 Agent
 */
function resolveAgent(agentName: string): Agent | null {
  const store = getStore()

  // "auto" 表示使用默认 agent
  if (agentName === 'auto' || !agentName) {
    // 获取第一个可用的 agent，或创建一个临时的
    const agents = store.getAllAgents()
    if (agents.length > 0) {
      return agents[0]!
    }

    // 返回一个默认配置
    return {
      id: 'default',
      name: 'default',
      persona: 'efficient',
      personaConfig: {
        name: 'efficient',
        description: 'Default efficient agent',
        traits: {
          codeStyle: 'minimal',
          commentLevel: 'sparse',
          errorHandling: 'essential',
          namingConvention: 'concise',
        },
        preferences: {
          preferAbstraction: false,
          preferPatterns: false,
          preferDocumentation: false,
        },
        systemPrompt: 'You are an efficient developer.',
      },
      description: 'Default agent',
      status: 'working',
      stats: { tasksCompleted: 0, tasksFailed: 0, totalWorkTime: 0 },
      createdAt: new Date().toISOString(),
    }
  }

  return store.getAgent(agentName) || null
}

/**
 * 构建节点执行上下文
 */
function buildNodeContext(instance: WorkflowInstance): string {
  const completedNodes = Object.entries(instance.nodeStates)
    .filter(([, state]) => state.status === 'done')
    .map(([nodeId, state]) => `- ${nodeId}: ${JSON.stringify(state.result || 'completed')}`)

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
    loopCount: 0,  // 将由具体节点设置
    nodeStates: instance.nodeStates,
  }
}
