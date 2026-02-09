/**
 * 生成 Workflow
 * 调用 Claude 生成 JSON 格式的执行计划，支持完整的控制流
 *
 * 智能化增强：
 * - 项目上下文感知：自动分析项目结构，让 AI 生成更精准的 workflow
 * - 执行历史学习：从历史任务中学习，避免重复错误
 */

import { invokeBackend, resolveBackend } from '../backend/index.js'
import { buildJsonWorkflowPrompt } from '../prompts/index.js'
import { parseJson, validateJsonWorkflow, extractJson } from './index.js'
import { appendConversation, appendJsonlLog } from '../store/TaskLogStore.js'
import { loadConfig } from '../config/loadConfig.js'
import { createLogger } from '../shared/logger.js'
import {
  analyzeProjectContext,
  formatProjectContextForPrompt,
  learnFromHistory,
  formatInsightsForPrompt,
} from '../analysis/index.js'
import { BUILTIN_PERSONAS } from '../persona/builtinPersonas.js'
import type { Task } from '../types/task.js'
import type { Workflow } from './types.js'
import type { InvokeOptions } from '../backend/types.js'

const logger = createLogger('workflow-gen')

/**
 * 创建直接回答的 Workflow
 * 当 AI 没有返回 JSON 而是直接回答问题时使用
 */
function createDirectAnswerWorkflow(
  task: { id: string; title: string },
  answer: string,
  claudeSessionId?: string
): Workflow {
  return {
    id: `workflow-direct-${Date.now()}`,
    name: '直接回答',
    description: 'AI 直接回答了问题',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'start', type: 'start', name: '开始' },
      { id: 'end', type: 'end', name: '结束' },
    ],
    edges: [{ id: 'e1', from: 'start', to: 'end' }],
    variables: {
      taskId: task.id,
      taskTitle: task.title,
      claudeSessionId,
      directAnswer: answer, // 保存直接回答
      isDirectAnswer: true, // 标记为直接回答类型
    },
  }
}

/**
 * 根据任务生成 Workflow (JSON 格式)
 * 集成项目上下文和历史学习
 */
export async function generateWorkflow(task: Task): Promise<Workflow> {
  // 获取可用 persona 列表
  const availablePersonas = Object.values(BUILTIN_PERSONAS)

  // 智能化增强：并行获取项目上下文和历史学习
  logger.info('分析项目上下文和历史记录...')
  const [projectContext, learningInsights] = await Promise.all([
    analyzeProjectContext(),
    learnFromHistory(task.description || task.title),
  ])

  // 格式化上下文
  const projectContextPrompt = formatProjectContextForPrompt(projectContext)
  const learningPrompt = formatInsightsForPrompt(learningInsights)

  logger.debug(`项目类型: ${projectContext.projectType}, 语言: ${projectContext.mainLanguage}`)
  logger.debug(`相关历史任务: ${learningInsights.relatedTasks.length} 个`)

  // 检查是否启用 Agent Teams
  const config = await loadConfig()
  const backend = await resolveBackend()
  const useAgentTeams =
    backend.capabilities.supportsAgentTeams && (config.backend?.enableAgentTeams ?? false)

  if (useAgentTeams) {
    logger.info('🤝 启用 Agent Teams 协作生成 workflow')
  }

  // 构建 prompt（生成 Workflow 固定使用"软件架构师"角色）
  logger.debug('构建 prompt...')
  const prompt = buildJsonWorkflowPrompt(
    task,
    availablePersonas,
    projectContextPrompt,
    learningPrompt,
    useAgentTeams
  )
  logger.debug(`Prompt 长度: ${prompt.length} 字符`)

  // 调用 Claude (不传 persona，因为模板中已定义"软件架构师"角色)
  logger.info('调用 Claude 生成执行计划...')
  const model = config.backend?.model ?? config.claude?.model ?? 'opus'

  const result = await invokeBackend({
    prompt,
    stream: true,
    model,
  })

  if (!result.ok) {
    logger.error(`Claude 调用失败: ${result.error.message}`)
    throw new Error(`Claude invocation failed: ${result.error.message}`)
  }

  const { value: invokeResult } = result
  logger.info(
    `Claude 响应: ${invokeResult.response.length} 字符, 耗时 ${(invokeResult.durationMs / 1000).toFixed(1)}s`
  )

  // 记录 AI 对话到任务日志
  appendConversation(task.id, {
    timestamp: new Date().toISOString(),
    phase: 'planning',
    prompt: invokeResult.prompt,
    response: invokeResult.response,
    durationMs: invokeResult.durationMs,
    durationApiMs: invokeResult.durationApiMs,
    costUsd: invokeResult.costUsd,
  })
  logger.debug('对话已保存到任务日志')

  // 保存 Claude 会话 ID，供后续节点复用（加速执行）
  const claudeSessionId = invokeResult.sessionId
  if (claudeSessionId) {
    logger.debug(`Claude session: ${claudeSessionId.slice(0, 8)}...`)
  }

  // 提取 JSON 内容
  logger.info('解析 JSON Workflow...')
  const jsonContent = extractJson(invokeResult.response)
  if (!jsonContent) {
    // JSON 提取失败 - 可能是简单问答，AI 直接给出了答案
    logger.info('AI 直接返回了答案，创建简单回答 workflow')
    return createDirectAnswerWorkflow(task, invokeResult.response, claudeSessionId)
  }
  logger.debug(`提取到 JSON 对象`)

  // 验证 JSON 格式
  logger.debug('验证 JSON 格式...')
  const validation = validateJsonWorkflow(jsonContent)
  if (!validation.valid) {
    logger.error(`JSON 验证失败: ${validation.errors.join(', ')}`)
    throw new Error(`Invalid workflow JSON: ${validation.errors.join(', ')}`)
  }
  logger.debug('JSON 格式验证通过')

  // 解析为 Workflow
  const workflow = parseJson(jsonContent)
  logger.info(`Workflow 解析完成: ${workflow.nodes.length} 个节点`)

  // 关联任务信息和 Claude 会话
  workflow.variables = {
    ...workflow.variables,
    taskId: task.id,
    taskTitle: task.title,
    claudeSessionId, // 复用会话加速后续执行
  }

  // 打印节点摘要
  const taskNodes = workflow.nodes.filter(n => n.type === 'task')
  logger.info(`任务节点: ${taskNodes.length} 个`)
  for (const node of taskNodes) {
    logger.info(`  - ${node.name}`)
  }

  // 写入结构化事件日志
  appendJsonlLog(task.id, {
    event: 'workflow_generated',
    message: `Workflow generated: ${workflow.name}`,
    durationMs: invokeResult.durationMs,
    data: {
      workflowId: workflow.id,
      totalNodes: workflow.nodes.length,
      taskNodes: taskNodes.length,
      costUsd: invokeResult.costUsd,
    },
  })

  return workflow
}
