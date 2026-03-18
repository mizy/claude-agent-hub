/**
 * JSON 解析器
 * 将 JSON 格式的工作流定义转换为 Workflow 对象
 */

import { createLogger } from '../../shared/logger.js'
import { generateId } from '../../shared/generateId.js'
import { tryParseJson } from './repairJson.js'
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
 * Remove duplicate condition edges from the same source node.
 * Keeps the first occurrence, removes subsequent edges with identical condition strings.
 */
export function deduplicateConditionEdges(
  edges: Array<Omit<WorkflowEdge, 'id'> & { id?: string }>
): Array<Omit<WorkflowEdge, 'id'> & { id?: string }> {
  const seen = new Map<string, Set<string>>() // from -> set of conditions
  return edges.filter(edge => {
    if (!edge.condition) return true
    const key = String(edge.condition).trim()
    const fromSet = seen.get(edge.from) || new Set()
    if (fromSet.has(key)) {
      logger.warn(`Dedup: removed duplicate edge ${edge.from}→${edge.to} (condition: '${key}')`)
      return false
    }
    fromSet.add(key)
    seen.set(edge.from, fromSet)
    return true
  })
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

  // Detect duplicate node IDs (LLM sometimes reuses "start"/"end" for task nodes)
  const seenIds = new Set<string>()
  for (const node of nodes) {
    if (seenIds.has(node.id)) {
      throw new Error(
        `Duplicate node id "${node.id}" — "start" and "end" are reserved for structural nodes only. Use a descriptive id (e.g. "analyze", "summarize") for task nodes.`
      )
    }
    seenIds.add(node.id)
  }

  // Deduplicate condition edges, then auto-generate edge IDs
  const dedupedEdges = deduplicateConditionEdges(data.edges || [])
  const edges: WorkflowEdge[] = dedupedEdges.map((e, i) => ({
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

  // Warn if loop-back target has parallel siblings (fan-out issue)
  const loopBackEdges = edges.filter(e => e.maxLoops && e.maxLoops > 0)
  if (loopBackEdges.length > 0) {
    // Build outgoing edges map: source -> [target]
    const outgoing = new Map<string, string[]>()
    for (const e of edges) {
      const list = outgoing.get(e.from) || []
      list.push(e.to)
      outgoing.set(e.from, list)
    }
    for (const lbEdge of loopBackEdges) {
      const targetId = lbEdge.to
      // Find all sources that have an edge pointing to targetId
      const parents = edges.filter(e => e.to === targetId && !e.maxLoops).map(e => e.from)
      for (const parent of parents) {
        const siblings = (outgoing.get(parent) || []).filter(id => id !== targetId)
        if (siblings.length > 0) {
          logger.warn(
            `loop-back target "${targetId}" has parallel siblings that will not be reset: [${siblings.join(', ')}]. Consider pointing loop-back to the common source "${parent}" instead.`
          )
        }
      }
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
export function validateJsonWorkflow(input: unknown): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof input !== 'object' || input === null) {
    return { valid: false, errors: ['Input must be an object'], warnings: [] }
  }

  const data = input as Record<string, unknown>

  // 必填字段
  if (!data.name || typeof data.name !== 'string') {
    errors.push('Missing or invalid "name" field')
  }

  if (!Array.isArray(data.nodes)) {
    errors.push('Missing or invalid "nodes" array')
  } else {
    // 验证每个节点，缺失 name 时自动用 id 兜底
    for (let i = 0; i < data.nodes.length; i++) {
      const node = data.nodes[i] as Record<string, unknown>
      if (!node.id) errors.push(`Node at index ${i} missing "id"`)
      if (!node.type) errors.push(`Node at index ${i} missing "type"`)
      if (!node.name && node.id) {
        // Auto-fix: use id as name fallback
        node.name = node.id
        warnings.push(`Node "${node.id}" missing "name", auto-filled with id`)
      } else if (!node.name) {
        errors.push(`Node at index ${i} missing "name"`)
      }

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
      if (type === 'schedule-wait' && !node.scheduleWait) {
        errors.push(`Schedule-wait node "${node.id}" missing "scheduleWait" config`)
      }
      if (type === 'lark-notify' && !node.larkNotify) {
        errors.push(`Lark-notify node "${node.id}" missing "larkNotify" config`)
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

  // Detect duplicate condition edges from the same source node (warning only, no mutation)
  if (Array.isArray(data.edges)) {
    const condByFrom = new Map<string, Set<string>>()
    for (const edge of data.edges as Array<Record<string, unknown>>) {
      if (edge.condition && edge.from) {
        const from = String(edge.from)
        const cond = String(edge.condition).trim()
        const seen = condByFrom.get(from) || new Set()
        if (seen.has(cond)) {
          warnings.push(`节点 '${from}' 存在重复条件边 (condition: '${cond}')`)
        } else {
          seen.add(cond)
          condByFrom.set(from, seen)
        }
      }
    }
  }

  // Warn if loop-back target has parallel siblings (fan-out issue)
  if (Array.isArray(data.edges)) {
    const edgeList = data.edges as Array<Record<string, unknown>>
    const loopBacks = edgeList.filter(e => e.maxLoops && Number(e.maxLoops) > 0)
    if (loopBacks.length > 0) {
      const outgoing = new Map<string, string[]>()
      for (const e of edgeList) {
        if (e.from) {
          const from = String(e.from)
          const list = outgoing.get(from) || []
          list.push(String(e.to))
          outgoing.set(from, list)
        }
      }
      for (const lb of loopBacks) {
        const targetId = String(lb.to)
        const parents = edgeList
          .filter(e => String(e.to) === targetId && !(e.maxLoops && Number(e.maxLoops) > 0))
          .map(e => String(e.from))
        for (const parent of parents) {
          const siblings = (outgoing.get(parent) || []).filter(id => id !== targetId)
          if (siblings.length > 0) {
            warnings.push(
              `loop-back 目标 '${targetId}' 存在并行兄弟节点 [${siblings.join(', ')}]，循环重置时可能影响这些分支。建议将 loop-back 指向共同源头 '${parent}'`
            )
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * 从 Claude 响应中提取 JSON
 */
export function extractJson(response: string): JsonWorkflowInput {
  // 尝试提取 ```json ... ``` 代码块，取最后一个（Agent Teams 模式下讨论内包含示例块，最终 workflow 在最后）
  const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/g
  let lastCodeBlock: string | null = null
  let codeBlockMatch: RegExpExecArray | null
  while ((codeBlockMatch = codeBlockRegex.exec(response)) !== null) {
    const candidate = codeBlockMatch[1]?.trim()
    if (candidate?.startsWith('{')) {
      lastCodeBlock = candidate
    }
  }
  if (lastCodeBlock) {
    return tryParseJson(lastCodeBlock)
  }

  // 尝试直接解析为 JSON
  const trimmed = response.trim()
  if (trimmed.startsWith('{')) {
    return tryParseJson(trimmed)
  }

  // 尝试找到最后一个完整 { } JSON（避免取到讨论中的片段）
  // Find the last top-level '{' (depth 0) to handle nested braces correctly
  let jsonStart = -1
  {
    let scanDepth = 0
    let scanInStr = false
    let scanEsc = false
    for (let i = 0; i < response.length; i++) {
      const ch = response[i]
      if (scanEsc) { scanEsc = false; continue }
      if (ch === '\\' && scanInStr) { scanEsc = true; continue }
      if (ch === '"') { scanInStr = !scanInStr; continue }
      if (!scanInStr) {
        if (ch === '{' && scanDepth === 0) jsonStart = i
        if (ch === '{') scanDepth++
        if (ch === '}') scanDepth--
      }
    }
  }
  if (jsonStart !== -1) {
    let depth = 0
    let jsonEnd = jsonStart
    let inString = false
    let escape = false
    for (let i = jsonStart; i < response.length; i++) {
      const ch = response[i]
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\' && inString) {
        escape = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (!inString) {
        if (ch === '{') depth++
        if (ch === '}') depth--
        if (depth === 0) {
          jsonEnd = i + 1
          break
        }
      }
    }
    return tryParseJson(response.slice(jsonStart, jsonEnd))
  }

  throw new Error('No valid JSON found in response')
}

