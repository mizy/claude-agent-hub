/**
 * Workflow 执行逻辑
 * 负责节点调度、结果处理、网关逻辑等核心执行流程
 */

import { createLogger } from '../../shared/logger.js'
import {
  getWorkflow,
  getInstance,
  incrementLoopCount,
  resetNodeState,
  saveInstance,
} from '../../store/WorkflowStore.js'
import {
  markNodeDone,
  markNodeFailed,
  completeWorkflowInstance,
  failWorkflowInstance,
  isNodeCompleted,
  checkWorkflowCompletion,
} from './StateManager.js'
import { evaluateCondition } from './ConditionEvaluator.js'
import { buildEvalContext } from '../nodeResultProcessor.js'
import type {
  Workflow,
  WorkflowEdge,
  WorkflowInstance,
  ExecuteNodeResult,
} from '../types.js'

const logger = createLogger('workflow-execution')

/** Default max loops for loop-back edges without explicit maxLoops */
const DEFAULT_MAX_LOOPS = 5

// ============ 节点调度 ============

/**
 * 获取节点的下游节点（考虑条件和循环）
 */
export async function getNextNodes(
  workflowId: string,
  instanceId: string,
  currentNodeId: string
): Promise<string[]> {
  const workflow = getWorkflow(workflowId)
  const instance = getInstance(instanceId)

  if (!workflow || !instance) {
    return []
  }

  const currentNode = workflow.nodes.find(n => n.id === currentNodeId)
  if (!currentNode) {
    return []
  }

  // 获取所有出边
  const outEdges = workflow.edges.filter(e => e.from === currentNodeId)
  const nextNodes: string[] = []

  for (const edge of outEdges) {
    const shouldFollow = await shouldFollowEdge(edge, instance, workflow)

    if (shouldFollow) {
      // 处理循环边（有 maxLoops 属性的边，或从拓扑序靠后指向靠前的 loop-back 边）
      const isLoopBackEdge = edge.maxLoops !== undefined || isTopologicalLoopBack(edge, workflow)
      if (isLoopBackEdge) {
        const maxLoops = edge.maxLoops ?? DEFAULT_MAX_LOOPS
        const currentLoops = instance.loopCounts[edge.id] || 0

        if (currentLoops >= maxLoops) {
          logger.debug(`Edge ${edge.id} reached max loops (${maxLoops})`)
          continue
        }

        // 增加循环计数
        incrementLoopCount(instanceId, edge.id)

        // 重置目标节点及其下游节点（到当前节点之前）
        resetLoopPath(instanceId, edge.to, currentNodeId, workflow)

        logger.debug(`Loop edge ${edge.id}: count ${currentLoops + 1}/${maxLoops}`)
      }

      nextNodes.push(edge.to)
    }
  }

  return nextNodes
}

/**
 * 判断是否应该走这条边
 */
async function shouldFollowEdge(
  edge: WorkflowEdge,
  instance: WorkflowInstance,
  _workflow: Workflow
): Promise<boolean> {
  // 如果有条件表达式，需要求值
  if (edge.condition) {
    const context = buildEvalContext(instance)
    context.loopCount = instance.loopCounts[edge.id] || 0

    const result = evaluateCondition(edge.condition, context)
    logger.debug(`Edge ${edge.id} condition "${edge.condition}" = ${result}`)

    return result
  }

  return true
}

/**
 * 检查节点是否可以执行（所有上游节点完成）
 */
export function canExecuteNode(
  nodeId: string,
  workflow: Workflow,
  instance: WorkflowInstance
): boolean {
  const node = workflow.nodes.find(n => n.id === nodeId)
  if (!node) return false

  // start 节点总是可以执行
  if (node.type === 'start') return true

  // 检查节点是否在活跃循环体中
  const loopBodyResult = canExecuteAsLoopBodyNode(nodeId, instance)
  if (loopBodyResult.isInLoop) {
    return loopBodyResult.canExecute
  }

  // 获取所有入边
  const inEdges = workflow.edges.filter(e => e.to === nodeId)

  // 检查是否有入边来自活跃循环节点
  // 如果循环仍在执行中（activeLoops 中存在），不应该走出循环
  for (const edge of inEdges) {
    if (instance.activeLoops && edge.from in instance.activeLoops) {
      logger.debug(`Node ${nodeId} blocked: upstream loop ${edge.from} is still active`)
      return false
    }
  }

  // 所有入边的源节点必须完成（join 节点和并行汇聚点均需全部完成）
  return inEdges.every(edge => {
    const sourceState = instance.nodeStates[edge.from]
    return sourceState != null && isNodeCompleted(sourceState)
  })
}

/**
 * 检查节点是否可以作为循环体节点执行
 *
 * 循环体节点没有显式的 edge 连接，它们依赖：
 * 1. activeLoops 状态记录哪些循环正在执行
 * 2. bodyNodes 数组定义执行顺序
 *
 * @returns isInLoop: 节点是否在活跃循环体中; canExecute: 是否可以执行
 */
function canExecuteAsLoopBodyNode(
  nodeId: string,
  instance: WorkflowInstance
): { isInLoop: boolean; canExecute: boolean } {
  if (!instance.activeLoops) {
    return { isInLoop: false, canExecute: false }
  }

  // 查找节点所属的活跃循环
  for (const [loopNodeId, bodyNodes] of Object.entries(instance.activeLoops)) {
    const nodeIndex = bodyNodes.indexOf(nodeId)
    if (nodeIndex === -1) continue

    // 节点在此循环体中
    const loopState = instance.nodeStates[loopNodeId]

    // 如果是第一个 body 节点，循环节点必须完成
    if (nodeIndex === 0) {
      const canExec = loopState?.status === 'done'
      logger.debug(`Loop body node ${nodeId} (first): loop ${loopNodeId} done=${canExec}`)
      return { isInLoop: true, canExecute: canExec }
    }

    // 否则，前一个 body 节点必须完成
    const prevNodeId = bodyNodes[nodeIndex - 1]!
    const prevState = instance.nodeStates[prevNodeId]
    const canExec = prevState?.status === 'done' || prevState?.status === 'skipped'
    logger.debug(`Loop body node ${nodeId}: prev node ${prevNodeId} done=${canExec}`)
    return { isInLoop: true, canExecute: canExec }
  }

  return { isInLoop: false, canExecute: false }
}

/**
 * 获取可执行的节点列表
 */
export function getReadyNodes(workflow: Workflow, instance: WorkflowInstance): string[] {
  const readyNodes: string[] = []

  for (const node of workflow.nodes) {
    const state = instance.nodeStates[node.id]

    // 只检查 pending 或 ready 状态的节点
    if (state?.status !== 'pending' && state?.status !== 'ready') {
      continue
    }

    if (canExecuteNode(node.id, workflow, instance)) {
      readyNodes.push(node.id)
    }
  }

  return readyNodes
}

// ============ 节点执行处理 ============

/**
 * 处理节点执行结果
 */
export async function handleNodeResult(
  workflowId: string,
  instanceId: string,
  nodeId: string,
  result: ExecuteNodeResult
): Promise<string[]> {
  const workflow = getWorkflow(workflowId)
  const instance = getInstance(instanceId)

  if (!workflow || !instance) return []

  const node = workflow.nodes.find(n => n.id === nodeId)
  if (!node) return []

  // 失败路径：标记失败并检查工作流是否应终止
  if (!result.success) {
    await markNodeFailed(instanceId, nodeId, result.error || 'Unknown error')
    const updatedInstance = getInstance(instanceId)!
    const completion = checkWorkflowCompletion(updatedInstance, workflow)
    if (completion.failed) {
      await failWorkflowInstance(instanceId, completion.error || 'Node failed')
    }
    return []
  }

  // 成功路径
  await markNodeDone(instanceId, nodeId, result.output)

  if (node.type === 'end') {
    await completeWorkflowInstance(instanceId)
    return []
  }

  // 循环节点：决定继续循环还是退出
  if (node.type === 'loop' && result.output) {
    const loopNext = handleLoopNodeResult(instanceId, nodeId, result.output)
    if (loopNext) return loopNext
  }

  // 循环体节点：按 bodyNodes 顺序路由
  const loopBodyNext = routeLoopBodyNode(instanceId, nodeId, workflow)
  if (loopBodyNext) return loopBodyNext

  // 普通路径：获取下游节点
  const nextNodes = await getNextNodes(workflowId, instanceId, nodeId)

  const updatedInstance = getInstance(instanceId)!
  const completion = checkWorkflowCompletion(updatedInstance, workflow)
  if (completion.completed) {
    await completeWorkflowInstance(instanceId)
    return []
  }

  // 当所有出边条件都为 false 且没有下游节点时，使用最后一条边作为 fallback
  if (nextNodes.length === 0) {
    const outEdges = workflow.edges.filter(e => e.from === nodeId)
    if (outEdges.length > 0) {
      const allEdgesConditional = outEdges.every(e => e.condition)
      if (allEdgesConditional) {
        // All conditions evaluated to false — use last edge as fallback (else branch)
        const fallbackEdge = outEdges[outEdges.length - 1]!
        const conditions = outEdges.map(e => e.condition).join(', ')
        const nodeOutput = updatedInstance.outputs[nodeId]
        const rawPreview = typeof nodeOutput === 'object' && nodeOutput != null && '_raw' in nodeOutput
          ? String((nodeOutput as Record<string, unknown>)._raw).slice(0, 200)
          : typeof nodeOutput === 'string' ? nodeOutput.slice(0, 200) : JSON.stringify(nodeOutput)?.slice(0, 200)
        logger.warn(
          `No outgoing edge condition matched for node "${nodeId}". Conditions: [${conditions}]. Output preview: "${rawPreview}". Using fallback edge → "${fallbackEdge.to}"`
        )

        const isFallbackLoopBack = fallbackEdge.maxLoops !== undefined || isTopologicalLoopBack(fallbackEdge, workflow)
        if (isFallbackLoopBack) {
          const maxLoops = fallbackEdge.maxLoops ?? DEFAULT_MAX_LOOPS
          const currentLoops = updatedInstance.loopCounts[fallbackEdge.id] || 0
          if (currentLoops >= maxLoops) {
            logger.debug(`Fallback edge ${fallbackEdge.id} reached max loops (${maxLoops}), completing workflow`)
            return []
          }
          incrementLoopCount(instanceId, fallbackEdge.id)
          resetLoopPath(instanceId, fallbackEdge.to, nodeId, workflow)
        }

        return [fallbackEdge.to]
      }
    }

    // All out edges exhausted (e.g. maxLoops depleted on loop-back edge) — dead end.
    // Complete the workflow to avoid it hanging forever with no enqueued nodes.
    logger.warn(`Node "${nodeId}" has no reachable downstream nodes (all edges exhausted), completing workflow`)
    await completeWorkflowInstance(instanceId)
    return []
  }

  return nextNodes
}

/**
 * 处理循环节点的执行结果，决定继续还是退出循环
 * 返回下一个要执行的节点列表，null 表示退出循环走正常 edges
 */
function handleLoopNodeResult(
  instanceId: string,
  nodeId: string,
  output: unknown
): string[] | null {
  const loopOutput = output as { shouldContinue?: boolean; bodyNodes?: string[] }

  if (loopOutput.shouldContinue && loopOutput.bodyNodes && loopOutput.bodyNodes.length > 0) {
    const instance = getInstance(instanceId)!
    instance.activeLoops = instance.activeLoops || {}
    instance.activeLoops[nodeId] = loopOutput.bodyNodes
    saveInstance(instance)

    for (const bodyNodeId of loopOutput.bodyNodes) {
      resetNodeState(instanceId, bodyNodeId)
    }

    logger.debug(
      `Loop node ${nodeId}: continuing with body nodes ${loopOutput.bodyNodes.join(', ')}`
    )
    return [loopOutput.bodyNodes[0]!]
  }

  // 退出循环
  const instance = getInstance(instanceId)!
  if (instance.activeLoops) {
    delete instance.activeLoops[nodeId]
    saveInstance(instance)
  }
  logger.debug(`Loop node ${nodeId}: exiting loop, following normal edges`)
  return null
}

/**
 * 检查节点是否在循环体内，路由到下一个 body 节点或回到 loop 节点
 * 返回下一个要执行的节点列表，null 表示不在循环体内
 */
function routeLoopBodyNode(
  instanceId: string,
  nodeId: string,
  workflow: Workflow
): string[] | null {
  const instance = getInstance(instanceId)!
  const loopNodeId = findParentLoop(nodeId, instance, workflow)
  if (!loopNodeId) return null

  const loopBodyNodes = instance.activeLoops?.[loopNodeId]
  if (!loopBodyNodes) return null

  const currentIndex = loopBodyNodes.indexOf(nodeId)
  if (currentIndex === -1) return null

  // 如果有显式出边（不只是回到 loop），走正常路径
  const outEdges = workflow.edges.filter(e => e.from === nodeId)
  if (outEdges.length > 0 && !outEdges.every(e => e.to === loopNodeId)) return null

  if (isLastBodyNode(nodeId, loopBodyNodes, instance)) {
    logger.debug(`Loop body completed, re-queueing loop node ${loopNodeId}`)
    resetNodeState(instanceId, loopNodeId)
    return [loopNodeId]
  }

  const nextBodyNode = loopBodyNodes[currentIndex + 1]
  if (nextBodyNode) {
    logger.debug(`Loop body continuing: ${nodeId} -> ${nextBodyNode}`)
    return [nextBodyNode]
  }

  return null
}

// ============ Loop-back edge 辅助函数 ============

/**
 * 判断边是否为拓扑序上的 loop-back（从后续节点指向前置节点）
 * 通过简单的 BFS 从 edge.to 出发，看能否沿正向边到达 edge.from
 */
function isTopologicalLoopBack(edge: WorkflowEdge, workflow: Workflow): boolean {
  const visited = new Set<string>()
  const queue = [edge.to]

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (nodeId === edge.from) return true
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    // 沿正向边遍历（不走有 maxLoops 的已知 loop-back 边）
    for (const e of workflow.edges) {
      if (e.from === nodeId && e.maxLoops === undefined) {
        queue.push(e.to)
      }
    }
  }

  return false
}

/**
 * 重置从 startNodeId 到 stopBeforeNodeId 之间所有节点的状态
 * 用于 loop-back edge 触发时，重置整个循环路径
 */
function resetLoopPath(
  instanceId: string,
  startNodeId: string,
  stopBeforeNodeId: string,
  workflow: Workflow
): void {
  const visited = new Set<string>()
  const queue = [startNodeId]

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (nodeId === stopBeforeNodeId) continue // 不重置触发 loop-back 的当前节点
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    resetNodeState(instanceId, nodeId)

    // 沿正向边继续重置下游
    for (const edge of workflow.edges) {
      if (edge.from === nodeId && edge.maxLoops === undefined) {
        queue.push(edge.to)
      }
    }
  }
}

// ============ 循环辅助函数 ============

/**
 * 查找节点所属的活跃循环
 */
function findParentLoop(
  nodeId: string,
  instance: WorkflowInstance,
  workflow: Workflow
): string | null {
  if (!instance.activeLoops) return null

  for (const [loopNodeId, bodyNodes] of Object.entries(instance.activeLoops)) {
    if (bodyNodes.includes(nodeId)) {
      return loopNodeId
    }
  }

  // 检查节点是否通过边连接到某个活跃循环的 bodyNode
  for (const [loopNodeId, bodyNodes] of Object.entries(instance.activeLoops)) {
    const inEdges = workflow.edges.filter(e => e.to === nodeId)
    for (const edge of inEdges) {
      if (bodyNodes.includes(edge.from)) {
        // 这个节点是循环体 bodyNode 的下游节点，也属于循环体
        return loopNodeId
      }
    }
  }

  return null
}

/**
 * 检查节点是否是循环体的最后一个节点
 */
function isLastBodyNode(nodeId: string, bodyNodes: string[], instance: WorkflowInstance): boolean {
  // 如果 bodyNodes 只有一个节点，它就是最后一个
  if (bodyNodes.length === 1 && bodyNodes[0] === nodeId) {
    return true
  }

  // 检查是否是 bodyNodes 中的最后一个
  const lastBodyNode = bodyNodes[bodyNodes.length - 1]
  if (nodeId === lastBodyNode) {
    return true
  }

  // 检查所有 bodyNodes 是否都已完成
  const allBodyNodesCompleted = bodyNodes.every(bn => {
    const state = instance.nodeStates[bn]
    return state?.status === 'done' || state?.status === 'skipped'
  })

  return allBodyNodesCompleted
}

// ============ 网关处理 ============

/**
 * 处理 parallel 网关节点
 */
export async function handleParallelGateway(
  workflowId: string,
  instanceId: string,
  nodeId: string
): Promise<string[]> {
  // parallel 网关立即完成，返回所有下游节点
  await markNodeDone(instanceId, nodeId)
  return getNextNodes(workflowId, instanceId, nodeId)
}

/**
 * 处理 join 网关节点
 */
export async function handleJoinGateway(
  workflowId: string,
  instanceId: string,
  nodeId: string
): Promise<string[]> {
  const workflow = getWorkflow(workflowId)
  const instance = getInstance(instanceId)

  if (!workflow || !instance) {
    return []
  }

  // 检查是否所有入边的源节点都完成
  const inEdges = workflow.edges.filter(e => e.to === nodeId)
  const allSourcesCompleted = inEdges.every(edge => {
    const sourceState = instance.nodeStates[edge.from]
    return sourceState && isNodeCompleted(sourceState)
  })

  if (allSourcesCompleted) {
    await markNodeDone(instanceId, nodeId)
    return getNextNodes(workflowId, instanceId, nodeId)
  }

  // 还有源节点未完成，保持等待
  return []
}
