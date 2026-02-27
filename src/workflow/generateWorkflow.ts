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
import { getBackendConfig } from '../config/index.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import {
  analyzeProjectContext,
  formatProjectContextForPrompt,
  learnFromHistory,
  formatInsightsForPrompt,
} from '../analysis/index.js'
import { retrieveRelevantMemories, formatMemoriesForPrompt, associativeRetrieve } from '../memory/index.js'
import { getAllPatterns, findMatchingPattern } from '../prompt-optimization/extractSuccessPattern.js'
import { formatFailureKnowledgeForPrompt } from '../prompt-optimization/failureKnowledgeBase.js'
import { getAllMemories } from '../store/MemoryStore.js'
import { migrateMemoryEntry } from '../memory/migrateMemory.js'
import { calculateStrength } from '../memory/forgettingEngine.js'
import { BUILTIN_PERSONAS } from '../persona/builtinPersonas.js'
import type { Task } from '../types/task.js'
import type { Workflow } from './types.js'

import type { SuccessPattern } from '../prompt-optimization/extractSuccessPattern.js'

const logger = createLogger('workflow-gen')

/** Format a matching success pattern as prompt context */
function formatSuccessPatternForPrompt(pattern: SuccessPattern): string {
  const lines = ['## 推荐执行模式（基于历史成功经验）\n']
  lines.push(`任务类型: ${pattern.taskType}`)
  lines.push(`参考节点序列: ${pattern.nodeSequence.join(' → ')}`)
  lines.push(`平均耗时: ${Math.round(pattern.avgDuration / 1000)}s`)
  lines.push(`样本数: ${pattern.sampleCount}`)
  lines.push(`置信度: ${(pattern.confidence * 100).toFixed(0)}%`)

  const agents = Object.entries(pattern.agentAssignments)
  if (agents.length > 0) {
    lines.push(`Agent 分配: ${agents.map(([, persona]) => persona).join(', ')}`)
  }

  lines.push('\n> 此模式来自历史成功任务，可作为节点设计参考。')
  return lines.join('\n')
}

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

  // 智能化增强：并行获取项目上下文、历史学习和记忆
  logger.info('分析项目上下文和历史记录...')
  let projectContext, learningInsights, memories
  try {
    const query = task.description || task.title
    const now = new Date()
    const allMigrated = getAllMemories().map(migrateMemoryEntry)
    const activeEntries = allMigrated.filter(e => calculateStrength(e, now) >= 10)

    ;[projectContext, learningInsights, memories] = await Promise.all([
      analyzeProjectContext(),
      learnFromHistory(query),
      (async () => {
        // Keyword-based retrieval + associative expansion (existing)
        const keywordResults = await retrieveRelevantMemories(query, { projectPath: process.cwd() })
        // Associative retrieval (hybrid keyword + activation spreading)
        const assocResults = await associativeRetrieve(query, activeEntries, 5)
        // Merge: deduplicate by id, keyword results first
        const seen = new Set(keywordResults.map(e => e.id))
        const extra = assocResults.filter(e => !seen.has(e.id))
        return [...keywordResults, ...extra].slice(0, 15)
      })(),
    ])
  } catch (error) {
    const msg = getErrorMessage(error)
    logger.error(`Planning preparation failed: ${msg}`)
    throw new Error(`Planning preparation failed (analyzeProjectContext/learnFromHistory/retrieveMemories): ${msg}`, { cause: error })
  }

  // 格式化上下文
  const projectContextPrompt = formatProjectContextForPrompt(projectContext)
  const learningPrompt = formatInsightsForPrompt(learningInsights)
  const memoryPrompt = formatMemoriesForPrompt(memories)

  // Success pattern + failure knowledge injection
  const query = task.description || task.title
  const matchingPattern = findMatchingPattern(query, getAllPatterns())
  const successPatternPrompt = matchingPattern
    ? formatSuccessPatternForPrompt(matchingPattern)
    : ''
  const failureKnowledgePrompt = formatFailureKnowledgeForPrompt()

  logger.debug(`项目类型: ${projectContext.projectType}, 语言: ${projectContext.mainLanguage}`)
  logger.debug(`相关历史任务: ${learningInsights.relatedTasks.length} 个`)
  logger.debug(`相关记忆: ${memories.length} 条`)

  // 检查是否启用 Agent Teams
  const { resolveBackendConfig } = await import('../backend/index.js')
  const backendConfig = task.backend
    ? await resolveBackendConfig(task.backend)
    : await getBackendConfig()
  const backend = await resolveBackend(task.backend)
  const useAgentTeams =
    backend.capabilities.supportsAgentTeams && backendConfig.enableAgentTeams

  if (useAgentTeams) {
    logger.info('🤝 启用 Agent Teams 协作生成 workflow')
  }

  // 构建 prompt（生成 Workflow 固定使用"软件架构师"角色）
  logger.debug('构建 prompt...')
  // Combine memory + success patterns + failure knowledge into one context block
  const evolutionContext = [memoryPrompt, successPatternPrompt, failureKnowledgePrompt]
    .filter(Boolean)
    .join('\n\n')
  const prompt = buildJsonWorkflowPrompt(
    task,
    availablePersonas,
    projectContextPrompt,
    learningPrompt,
    useAgentTeams,
    evolutionContext
  )
  logger.debug(`Prompt 长度: ${prompt.length} 字符`)

  // 调用 Claude (不传 persona，因为模板中已定义"软件架构师"角色)
  logger.info('调用 Claude 生成执行计划...')
  const model = task.model ?? backendConfig.model

  const result = await invokeBackend({
    prompt,
    stream: true,
    model,
    backendType: task.backend,
  })

  if (!result.ok) {
    logger.error(`Claude 调用失败 [${result.error.type}]: ${result.error.message}`)
    throw new Error(`Claude invocation failed [${result.error.type}]: ${result.error.message}`)
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
  let jsonContent
  try {
    jsonContent = extractJson(invokeResult.response)
  } catch (extractError) {
    const errMsg = getErrorMessage(extractError)
    // Distinguish: parse error (malformed JSON) vs no JSON (direct answer)
    const isParseError = errMsg.includes('Invalid JSON')
    if (!isParseError) {
      logger.info(`JSON 提取失败 (${errMsg})，创建简单回答 workflow`)
      return createDirectAnswerWorkflow(task, invokeResult.response, claudeSessionId)
    }

    // JSON found but malformed — retry backend call once
    logger.warn(`JSON 解析失败 (${errMsg})，2 秒后重试...`)
    await new Promise(resolve => setTimeout(resolve, 2000))
    const retryResult = await invokeBackend({
      prompt: prompt + '\n\n注意：请确保输出严格合法的 JSON 格式，不要有语法错误。',
      stream: true,
      model,
      backendType: task.backend,
    })
    if (!retryResult.ok) {
      throw new Error(`Retry failed [${retryResult.error.type}]: ${retryResult.error.message}`)
    }
    const retryInvoke = retryResult.value
    logger.info(`重试响应: ${retryInvoke.response.length} 字符`)
    appendConversation(task.id, {
      timestamp: new Date().toISOString(),
      phase: 'planning',
      prompt: retryInvoke.prompt,
      response: retryInvoke.response,
      durationMs: retryInvoke.durationMs,
      durationApiMs: retryInvoke.durationApiMs,
      costUsd: retryInvoke.costUsd,
    })
    try {
      jsonContent = extractJson(retryInvoke.response)
    } catch (retryExtractError) {
      const retryErrMsg = getErrorMessage(retryExtractError)
      if (retryErrMsg.includes('Invalid JSON')) {
        throw new Error(`Workflow JSON parse failed after retry: ${retryErrMsg}`)
      }
      logger.info(`重试后 JSON 提取失败 (${retryErrMsg})，创建简单回答 workflow`)
      return createDirectAnswerWorkflow(task, retryInvoke.response, claudeSessionId)
    }
    if (retryInvoke.sessionId) {
      // Update session ID from retry
      Object.assign(invokeResult, { sessionId: retryInvoke.sessionId })
    }
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
    taskBackend: task.backend,
    taskModel: task.model,
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
