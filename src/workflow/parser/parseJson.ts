/**
 * JSON 解析器
 * 将 JSON 格式的工作流定义转换为 Workflow 对象
 */

import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { generateId } from '../../shared/generateId.js'
import type { Workflow, WorkflowNode, WorkflowEdge } from '../types.js'

const logger = createLogger('json-parser')

/**
 * JSON 工作流输入格式
 */
export interface JsonWorkflowInput {
  name: string
  description?: string
  version?: '1.0' | '2.0'
  nodes: WorkflowNode[]
  edges: Array<Omit<WorkflowEdge, 'id'> & { id?: string }>
  variables?: Record<string, unknown>
  inputs?: Workflow['inputs']
  outputs?: Workflow['outputs']
  settings?: Workflow['settings']
}

/**
 * 解析 JSON 内容为 Workflow
 */
export function parseJson(input: JsonWorkflowInput | string, sourceFile?: string): Workflow {
  const data: JsonWorkflowInput = typeof input === 'string' ? tryParseJson(input) : input

  // 验证必填字段
  if (!data.name) {
    throw new Error('Workflow name is required')
  }
  if (!data.nodes || data.nodes.length === 0) {
    throw new Error('At least one node is required')
  }

  // 确保有 start 和 end 节点
  const hasStart = data.nodes.some(n => n.type === 'start')
  const hasEnd = data.nodes.some(n => n.type === 'end')

  const nodes = [...data.nodes]
  if (!hasStart) {
    nodes.unshift({ id: 'start', type: 'start', name: '开始' })
    logger.debug('Auto-added start node')
  }
  if (!hasEnd) {
    nodes.push({ id: 'end', type: 'end', name: '结束' })
    logger.debug('Auto-added end node')
  }

  // 自动生成边 ID
  const edges: WorkflowEdge[] = (data.edges || []).map((e, i) => ({
    ...e,
    id: e.id || `e${i + 1}`,
  }))

  // 验证节点引用
  const nodeIds = new Set(nodes.map(n => n.id))
  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) {
      throw new Error(`Edge ${edge.id} references unknown source node: ${edge.from}`)
    }
    if (!nodeIds.has(edge.to)) {
      throw new Error(`Edge ${edge.id} references unknown target node: ${edge.to}`)
    }
  }

  // 验证 loop/foreach body 节点
  for (const node of nodes) {
    if (node.loop?.bodyNodes) {
      for (const bodyId of node.loop.bodyNodes) {
        if (!nodeIds.has(bodyId)) {
          throw new Error(`Loop node ${node.id} references unknown body node: ${bodyId}`)
        }
      }
    }
    if (node.foreach?.bodyNodes) {
      for (const bodyId of node.foreach.bodyNodes) {
        if (!nodeIds.has(bodyId)) {
          throw new Error(`Foreach node ${node.id} references unknown body node: ${bodyId}`)
        }
      }
    }
    if (node.switch?.cases) {
      for (const caseItem of node.switch.cases) {
        if (caseItem.value !== 'default' && !nodeIds.has(caseItem.targetNode)) {
          throw new Error(
            `Switch node ${node.id} references unknown target node: ${caseItem.targetNode}`
          )
        }
      }
    }
  }

  const workflow: Workflow = {
    id: generateId(),
    name: data.name,
    description: data.description || '',
    version: data.version || '2.0',
    nodes,
    edges,
    variables: data.variables || {},
    inputs: data.inputs,
    outputs: data.outputs,
    settings: data.settings,
    createdAt: new Date().toISOString(),
    sourceFile,
  }

  logger.info(
    `Parsed JSON workflow: ${workflow.name} (${nodes.length} nodes, ${edges.length} edges)`
  )

  return workflow
}

/**
 * 验证 JSON 工作流格式
 */
export function validateJsonWorkflow(input: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (typeof input !== 'object' || input === null) {
    return { valid: false, errors: ['Input must be an object'] }
  }

  const data = input as Record<string, unknown>

  // 必填字段
  if (!data.name || typeof data.name !== 'string') {
    errors.push('Missing or invalid "name" field')
  }

  if (!Array.isArray(data.nodes)) {
    errors.push('Missing or invalid "nodes" array')
  } else {
    // 验证每个节点
    for (let i = 0; i < data.nodes.length; i++) {
      const node = data.nodes[i] as Record<string, unknown>
      if (!node.id) errors.push(`Node at index ${i} missing "id"`)
      if (!node.type) errors.push(`Node at index ${i} missing "type"`)
      if (!node.name) errors.push(`Node at index ${i} missing "name"`)

      // 验证节点类型对应的配置
      const type = node.type as string
      if (type === 'task' && !node.task) {
        errors.push(`Task node "${node.id}" missing "task" config`)
      }
      if (type === 'delay' && !node.delay) {
        errors.push(`Delay node "${node.id}" missing "delay" config`)
      }
      if (type === 'schedule' && !node.schedule) {
        errors.push(`Schedule node "${node.id}" missing "schedule" config`)
      }
      if (type === 'loop' && !node.loop) {
        errors.push(`Loop node "${node.id}" missing "loop" config`)
      }
      if (type === 'switch' && !node.switch) {
        errors.push(`Switch node "${node.id}" missing "switch" config`)
      }
      if (type === 'assign' && !node.assign) {
        errors.push(`Assign node "${node.id}" missing "assign" config`)
      }
      if (type === 'script' && !node.script) {
        errors.push(`Script node "${node.id}" missing "script" config`)
      }
      if (type === 'foreach' && !node.foreach) {
        errors.push(`Foreach node "${node.id}" missing "foreach" config`)
      }
    }
  }

  if (data.edges && !Array.isArray(data.edges)) {
    errors.push('"edges" must be an array')
  } else if (Array.isArray(data.edges)) {
    for (let i = 0; i < data.edges.length; i++) {
      const edge = data.edges[i] as Record<string, unknown>
      if (!edge.from) errors.push(`Edge at index ${i} missing "from"`)
      if (!edge.to) errors.push(`Edge at index ${i} missing "to"`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * 从 Claude 响应中提取 JSON
 */
export function extractJson(response: string): JsonWorkflowInput {
  // 尝试提取 ```json ... ``` 代码块
  const codeBlockMatch = response.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  if (codeBlockMatch?.[1]) {
    return tryParseJson(codeBlockMatch[1].trim())
  }

  // 尝试直接解析为 JSON
  const trimmed = response.trim()
  if (trimmed.startsWith('{')) {
    return tryParseJson(trimmed)
  }

  // 尝试找到第一个 { 开始的 JSON
  const jsonStart = response.indexOf('{')
  if (jsonStart !== -1) {
    // 找到匹配的 }
    let depth = 0
    let jsonEnd = jsonStart
    for (let i = jsonStart; i < response.length; i++) {
      if (response[i] === '{') depth++
      if (response[i] === '}') depth--
      if (depth === 0) {
        jsonEnd = i + 1
        break
      }
    }
    return tryParseJson(response.slice(jsonStart, jsonEnd))
  }

  throw new Error('No valid JSON found in response')
}

function tryParseJson(text: string): JsonWorkflowInput {
  try {
    return JSON.parse(text) as JsonWorkflowInput
  } catch (e) {
    const preview = text.length > 100 ? text.slice(0, 100) + '...' : text
    throw new Error(
      `Invalid JSON in AI response: ${getErrorMessage(e)}\n${preview}`
    )
  }
}
