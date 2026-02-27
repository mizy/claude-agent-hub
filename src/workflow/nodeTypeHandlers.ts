/**
 * 节点类型处理器
 * 处理不同类型节点的执行逻辑
 */

import { invokeBackend } from '../backend/index.js'
import { buildExecuteNodePrompt } from '../prompts/index.js'
import { appendConversation, appendExecutionLog } from '../store/TaskLogStore.js'
import { getUnconsumedMessages, markMessagesConsumed } from '../store/TaskMessageStore.js'
import { personaNeedsMcp } from '../persona/personaMcpConfig.js'
import { updateInstanceVariables } from '../store/WorkflowStore.js'
import { getTask, updateTask } from '../store/TaskStore.js'
import { createChildSpan, endSpan } from '../store/createSpan.js'
import { appendSpan } from '../store/TraceStore.js'
import { createLogger } from '../shared/logger.js'
import { getLarkConfig, getBackendConfig } from '../config/index.js'
// Note: sendReviewNotification is dynamically imported to avoid
// static dependency on the messaging/ layer (workflow should not depend on messaging)
import {
  executeDelayNode,
  executeScheduleNode,
  executeScheduleWaitNode,
  executeSwitchNode,
  executeAssignNode,
  executeScriptNode,
  executeLoopNode,
  executeForeachNode,
} from './engine/executeNewNodes.js'
import {
  extractStructuredOutput,
  resolvePersona,
  buildNodeContext,
  buildEvalContext,
} from './nodeResultProcessor.js'
import { evaluateExpression } from './engine/ExpressionEvaluator.js'
import type { Workflow, WorkflowNode, WorkflowInstance } from './types.js'
import type { TraceContext } from '../types/trace.js'

const logger = createLogger('node-handlers')

/**
 * 根据节点类型执行
 */
export async function executeNodeByType(
  node: WorkflowNode,
  workflow: Workflow,
  instance: WorkflowInstance,
  traceCtx?: TraceContext
): Promise<{ success: boolean; output?: unknown; error?: string; costUsd?: number }> {
  switch (node.type) {
    case 'start':
    case 'end':
      // 控制节点直接完成
      return { success: true }

    case 'task':
      return executeTaskNode(node, workflow, instance, traceCtx)

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

    case 'schedule-wait': {
      // If daemon resumed us after the wait period, proceed directly
      if (instance.variables?._scheduleWaitTriggered) {
        await updateInstanceVariables(instance.id, { _scheduleWaitTriggered: null })
        return { success: true }
      }

      const result = executeScheduleWaitNode(node, instance)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      // Persist resumeAt to instance variables so daemon can recover and resume.
      // taskId is injected into instance.variables at workflow start (see startWorkflow).
      const swTaskId = instance.variables?.taskId as string | undefined
      if (swTaskId) {
        await updateInstanceVariables(instance.id, {
          _scheduleWaitResumeAt: result.resumeAt,
          _scheduleWaitNodeId: node.id,
        })
        const task = getTask(swTaskId)
        // Accept 'pending' too — race condition: NodeWorker can execute schedule-wait
        // before executeTask.ts sets status to 'developing' (line after startWorkflow).
        if (task && (task.status === 'developing' || task.status === 'pending')) {
          updateTask(swTaskId, { status: 'waiting' })
        }
      }
      // Return WAITING_FOR_SCHEDULE so NodeWorker marks this node as waiting
      // without blocking the worker. The daemon's waitingRecoveryJob (every minute)
      // will resume the task when resumeAt has passed.
      return {
        success: false,
        error: 'WAITING_FOR_SCHEDULE',
      }
    }

    case 'lark-notify': {
      return executeLarkNotifyNode(node, instance)
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

  // 发送飞书通知 (dynamic import to avoid static dependency on messaging/ layer)
  try {
    const larkConfig = await getLarkConfig()
    const webhookUrl = larkConfig?.webhookUrl

    if (webhookUrl) {
      const { sendReviewNotification } = await import('../messaging/index.js')
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
  instance: WorkflowInstance,
  traceCtx?: TraceContext
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
  let context = buildNodeContext(instance)

  // 注入未消费的用户消息
  const taskId = instance.variables?.taskId as string | undefined
  if (taskId) {
    const pendingMessages = getUnconsumedMessages(taskId)
    if (pendingMessages.length > 0) {
      const msgText = pendingMessages
        .map(m => `[${m.source} ${m.timestamp}] ${m.content}`)
        .join('\n')
      context += `\n\n## 用户在任务执行中发来了以下消息\n请在执行当前节点时参考这些消息：\n${msgText}`
      markMessagesConsumed(
        taskId,
        pendingMessages.map(m => m.id)
      )
      logger.info(`Injected ${pendingMessages.length} user message(s) into node ${node.name}`)
    }
  }

  // 构建 prompt
  const prompt = buildExecuteNodePrompt(persona, workflow, node.name, taskPrompt, context)

  // 根据角色决定是否启用 MCP
  // 不需要外部集成的角色禁用 MCP，加速启动
  const disableMcp = !personaNeedsMcp(persona.name)

  // taskId 用于日志写入（复用上面已声明的 taskId）
  const logTaskId = taskId

  // 会话复用已禁用 — 每个节点使用独立会话以保证稳定性
  const existingSessionId = undefined

  // 读取任务级 backend/model 覆盖（存储在 workflow variables 中）
  const taskBackend = instance.variables?.taskBackend as string | undefined
  const taskModel = instance.variables?.taskModel as string | undefined

  // 从配置读取模型（任务级覆盖优先）
  const { resolveBackendConfig } = await import('../backend/index.js')
  const backendConfig = taskBackend
    ? await resolveBackendConfig(taskBackend)
    : await getBackendConfig()
  const model = taskModel ?? backendConfig.model

  // Create LLM span for tracing
  const llmSpan = traceCtx
    ? createChildSpan(traceCtx.currentSpan, `llm:${model}`, 'llm', {
        'llm.backend': taskBackend ?? 'claude-code',
        'llm.model': model,
        'llm.prompt_length': prompt.length,
        'llm.session_id': existingSessionId,
      })
    : undefined
  if (llmSpan && traceCtx) {
    appendSpan(traceCtx.taskId, llmSpan)
  }

  const result = await invokeBackend({
    prompt,
    mode: 'execute',
    persona,
    stream: true,
    disableMcp,
    sessionId: existingSessionId,
    model,
    backendType: taskBackend,
    timeoutMs: 30 * 60 * 1000, // 30 分钟超时
    onChunk: chunk => {
      // 流式输出到执行日志（原始模式，只清理 ANSI 颜色码）
      if (logTaskId) {
        appendExecutionLog(logTaskId, chunk, { raw: true })
      }
      process.stdout.write(chunk)
    },
  })

  // End LLM span with result
  if (llmSpan && traceCtx) {
    if (result.ok) {
      const finished = endSpan(llmSpan)
      finished.attributes['llm.response_length'] = result.value.response.length
      finished.attributes['llm.duration_api_ms'] = result.value.durationApiMs
      finished.attributes['llm.slot_wait_ms'] = result.value.slotWaitMs
      if (result.value.costUsd != null) {
        finished.cost = { amount: result.value.costUsd, currency: 'USD' }
      }
      appendSpan(traceCtx.taskId, finished)
    } else {
      const finished = endSpan(llmSpan, {
        error: {
          message: result.error.message,
          category: result.error.type === 'timeout' ? 'transient' : 'unknown',
        },
      })
      appendSpan(traceCtx.taskId, finished)
    }
  }

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

/**
 * 执行飞书通知节点 - 将内容发送到飞书群
 */
async function executeLarkNotifyNode(
  node: WorkflowNode,
  instance: WorkflowInstance
): Promise<{ success: boolean; output?: unknown; error?: string }> {
  // Allow missing larkNotify config — use defaults (auto-detect content & chatId)
  const config = node.larkNotify ?? {}

  // 解析消息内容
  let text: string | undefined
  if (config.content) {
    // Only evaluate as expression if content references outputs/variables;
    // otherwise treat as plain text (avoids expr-eval choking on emoji/unicode)
    const hasExpression = /\b(outputs|variables|loopCount|nodeStates)\b/.test(config.content)
    if (hasExpression) {
      const ctx = buildEvalContext(instance)
      const value = evaluateExpression(config.content, ctx)
      text = String(value)
    } else {
      text = config.content
    }
  } else {
    // 取最近完成节点的输出
    const doneNodes = Object.entries(instance.nodeStates || {})
      .filter(([, s]) => s.status === 'done' && s.completedAt)
      .sort((a, b) => new Date(b[1].completedAt!).getTime() - new Date(a[1].completedAt!).getTime())
    const latest = doneNodes[0]
    if (latest) {
      const latestNodeId = latest[0]
      const nodeOutput = instance.outputs?.[latestNodeId] as Record<string, unknown> | undefined
      text = nodeOutput?._raw as string | undefined
    }
  }

  if (!text) {
    return { success: false, error: 'lark-notify: no content to send' }
  }

  // 解析 chatId
  let chatId = config.chatId
  if (!chatId) {
    const larkConfig = await getLarkConfig()
    chatId = larkConfig?.chatId
  }
  if (!chatId) {
    try {
      const { getDefaultLarkChatId } = await import('../messaging/larkWsClient.js')
      chatId = getDefaultLarkChatId() ?? undefined
    } catch {
      // larkWsClient not available
    }
  }
  if (!chatId) {
    return { success: false, error: 'lark-notify: no chatId configured' }
  }

  // 截断过长消息
  if (text.length > 4000) {
    text = text.slice(0, 4000) + '\n\n...(truncated)'
  }

  // 发送卡片消息（支持 markdown 渲染）
  try {
    const { sendLarkCardViaApi, normalizeLarkMarkdown, buildCard } =
      await import('../messaging/index.js')

    // 将 markdown 文本按 --- 分段，构建卡片 elements
    const sections = text.split(/^(?:---+|\*\*\*+|___+)\s*$/m)
    const elements: Array<{ tag: 'markdown'; content: string } | { tag: 'hr' }> = []
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!.trim()
      if (section) {
        elements.push({ tag: 'markdown', content: normalizeLarkMarkdown(section) })
      }
      if (i < sections.length - 1) {
        elements.push({ tag: 'hr' })
      }
    }
    if (elements.length === 0) {
      elements.push({ tag: 'markdown', content: text })
    }

    const title = config.title || '任务通知'
    const card = buildCard(title, 'blue', elements)
    const sent = await sendLarkCardViaApi(chatId, card)
    if (!sent) {
      return { success: false, error: 'lark-notify: failed to send card' }
    }
    logger.info(`Lark notify card sent to ${chatId}, length=${text.length}`)
    return { success: true, output: { sent: true, chatId, length: text.length } }
  } catch (err) {
    logger.error(`Lark notify failed: ${err}`)
    return { success: false, error: 'lark-notify: failed to send card' }
  }
}
