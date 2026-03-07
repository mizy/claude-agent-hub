/**
 * 节点结果处理器
 * 提取输出、解析配置、构建上下文等辅助功能
 */

import { BUILTIN_AGENTS, getBuiltinAgent } from '../agents/builtinAgents.js'
import { createLogger } from '../shared/logger.js'
import type { AgentConfig } from '../types/agent.js'
import type { WorkflowInstance, EvalContext } from './types.js'

const logger = createLogger('result-processor')

/** 默认 Agent 名称 */
const DEFAULT_AGENT_NAME = 'Pragmatist'

/**
 * 从 Claude 响应中提取结构化输出
 *
 * 如果响应包含 JSON 代码块，则解析并返回结构化对象
 * 同时保留原始文本以便展示
 */
export function extractStructuredOutput(
  response: string
): { _raw: string } & Record<string, unknown> {
  const output: { _raw: string } & Record<string, unknown> = { _raw: response }

  // 尝试提取 JSON 代码块 (```json ... ```)
  const jsonBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/)
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    try {
      let parsed = JSON.parse(jsonBlockMatch[1])

      // 如果 JSON 只有一个 'result' 字段且是对象，展平它
      // 这样 outputs['node'].hasTypescript 可以直接访问
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        Object.keys(parsed).length === 1 &&
        'result' in parsed &&
        typeof parsed.result === 'object' &&
        parsed.result !== null
      ) {
        parsed = parsed.result
        logger.debug('Flattened single "result" wrapper from JSON output')
      }

      if (typeof parsed === 'object' && parsed !== null) {
        Object.assign(output, parsed)
        logger.debug(
          `Extracted structured output from JSON block: ${Object.keys(parsed).join(', ')}`
        )
      }
    } catch {
      // JSON 解析失败，忽略
    }
  }

  // 尝试匹配 key: value 或 key: **value** 模式
  // 例如: "hasTypescript: true" 或 "hasTypescript: **true**"
  const kvMatches = response.matchAll(/(\w+):\s*\*{0,2}(true|false|\d+(?:\.\d+)?)\*{0,2}/gi)
  for (const match of kvMatches) {
    const key = match[1]
    const valueStr = match[2]
    if (!key || !valueStr) continue

    // 避免覆盖已从 JSON 块提取的值
    if (key in output) continue

    // 转换值类型
    const lowerValue = valueStr.toLowerCase()
    if (lowerValue === 'true') {
      output[key] = true
    } else if (lowerValue === 'false') {
      output[key] = false
    } else if (!isNaN(Number(lowerValue))) {
      output[key] = Number(lowerValue)
    }
  }

  return output
}

/**
 * 解析 Agent
 *
 * 选择逻辑：
 * 1. 指定具体 agent 名字 → 使用该 agent
 * 2. 空值或 'auto' → 使用默认 Pragmatist
 * 3. 找不到指定的 agent → 回退到默认
 */
export function resolveAgent(agentName?: string): AgentConfig {
  // 默认 agent 一定存在（在 builtinAgents.ts 中定义）
  const defaultAgent = BUILTIN_AGENTS[DEFAULT_AGENT_NAME]!

  // 未指定或 auto，使用默认
  if (!agentName || agentName === 'auto') {
    return defaultAgent
  }

  // 尝试获取指定的 agent
  const agent = getBuiltinAgent(agentName)
  if (agent) {
    return agent
  }

  logger.warn(`Agent "${agentName}" not found, falling back to ${DEFAULT_AGENT_NAME}`)
  return defaultAgent
}

const MAX_CONTEXT_OUTPUT_LENGTH = 3000

/**
 * 提取节点输出的可读文本，优先使用 _raw 字段
 */
export function extractRawOutput(output: unknown, fallback = ''): string {
  if (!output) return fallback
  if (typeof output === 'string') return output
  if (typeof output === 'object' && output !== null && '_raw' in output) {
    const raw = (output as Record<string, unknown>)._raw
    if (typeof raw === 'string') return raw
  }
  return JSON.stringify(output)
}

/**
 * 构建节点执行上下文
 */
export function buildNodeContext(instance: WorkflowInstance): string {
  const completedNodes = Object.entries(instance.nodeStates)
    .filter(([, state]) => state.status === 'done')
    .map(([nodeId]) => {
      let text = extractRawOutput(instance.outputs[nodeId], 'completed')
      if (text.length > MAX_CONTEXT_OUTPUT_LENGTH) {
        text = text.slice(0, MAX_CONTEXT_OUTPUT_LENGTH) + '... (truncated)'
      }
      return `- ${nodeId}: ${text}`
    })

  if (completedNodes.length === 0) {
    return ''
  }

  return `已完成的节点:\n${completedNodes.join('\n')}`
}

/**
 * 为带连字符的 key 创建下划线别名
 * 例如: { 'rerun-tests': {...} } → { 'rerun-tests': {...}, rerun_tests: {...} }
 *
 * 这样在 expr-eval 表达式中可以使用 outputs.rerun_tests.summary.total_failed
 * 因为 expr-eval 不支持方括号语法 outputs['rerun-tests']
 */
function createHyphenAliases<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj }
  for (const key of Object.keys(obj)) {
    if (key.includes('-')) {
      const aliasKey = key.replace(/-/g, '_')
      // 只在别名 key 不存在时创建，避免覆盖
      if (!(aliasKey in result)) {
        result[aliasKey as keyof T] = obj[key] as T[keyof T]
      }
    }
  }
  return result
}

/**
 * 构建表达式求值上下文
 *
 * 自动为带连字符的节点 ID 创建下划线别名，以便在表达式中使用
 * 例如: outputs['rerun-tests'] → outputs.rerun_tests
 */
export function buildEvalContext(instance: WorkflowInstance): EvalContext {
  return {
    outputs: createHyphenAliases(instance.outputs),
    variables: instance.variables,
    loopCount: 0, // 将由具体节点设置
    nodeStates: createHyphenAliases(instance.nodeStates),
  }
}
