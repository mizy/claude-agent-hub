/**
 * 生成 Workflow
 * 调用 Claude 生成 JSON 格式的执行计划，支持完整的控制流
 */

import { invokeClaudeCode } from '../claude/invokeClaudeCode.js'
import { buildJsonWorkflowPrompt } from '../prompts/index.js'
import { parseJson, validateJsonWorkflow, extractJson } from '../workflow/index.js'
import { appendConversation } from '../store/TaskStore.js'
import { getStore } from '../store/index.js'
import { createLogger } from '../shared/logger.js'
import type { AgentContext } from '../types/agent.js'
import type { Workflow } from '../workflow/types.js'

const logger = createLogger('workflow-gen')

/**
 * 根据任务生成 Workflow (JSON 格式)
 */
export async function generateWorkflow(context: AgentContext): Promise<Workflow> {
  const { agent, task } = context

  // 获取可用 agent 列表（完整对象，包含能力描述）
  const store = getStore()
  const availableAgents = store.getAllAgents()

  // 构建 prompt
  logger.debug('构建 prompt...')
  const prompt = buildJsonWorkflowPrompt(agent, task, availableAgents)
  logger.debug(`Prompt 长度: ${prompt.length} 字符`)

  // 调用 Claude (不使用 mode，避免触发 Claude Code 的 Plan Mode)
  logger.info('调用 Claude 生成执行计划...')
  const result = await invokeClaudeCode({
    prompt,
    persona: agent.personaConfig,
    stream: true,
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
  })
  logger.debug('对话已保存到任务日志')

  // 提取 JSON 内容
  logger.info('解析 JSON Workflow...')
  const jsonContent = extractJson(invokeResult.response)
  if (!jsonContent) {
    logger.error('无法从响应中提取 JSON')
    logger.error(`响应内容 (前500字): ${invokeResult.response.slice(0, 500)}`)
    throw new Error('Failed to extract JSON workflow from response')
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

  // 关联任务信息
  workflow.variables = {
    ...workflow.variables,
    taskId: task.id,
    taskTitle: task.title,
  }

  // 打印节点摘要
  const taskNodes = workflow.nodes.filter(n => n.type === 'task')
  logger.info(`任务节点: ${taskNodes.length} 个`)
  for (const node of taskNodes) {
    logger.info(`  - ${node.name}`)
  }

  return workflow
}
