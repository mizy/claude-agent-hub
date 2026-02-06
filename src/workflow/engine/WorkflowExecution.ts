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
import type {
  Workflow,
  WorkflowEdge,
  WorkflowInstance,
  EvalContext,
  ExecuteNodeResult,
} from '../types.js'

const logger = createLogger('workflow-execution')

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
      // 处理循环边
      if (edge.maxLoops !== undefined) {
        const currentLoops = instance.loopCounts[edge.id] || 0

        if (currentLoops >= edge.maxLoops) {
          logger.debug(`Edge ${edge.id} reached max loops (${edge.maxLoops})`)
          continue
        }

        // 增加循环计数
        incrementLoopCount(instanceId, edge.id)

        // 重置目标节点状态
        resetNodeState(instanceId, edge.to)

        logger.debug(`Loop edge ${edge.id}: count ${currentLoops + 1}/${edge.maxLoops}`)
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
    const context: EvalContext = {
      outputs: instance.outputs,
      variables: instance.variables,
      loopCount: instance.loopCounts[edge.id] || 0,
      nodeStates: instance.nodeStates,
    }

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

  // 特殊处理 join 节点：需要所有入边的源节点都完成
  if (node.type === 'join') {
    return inEdges.every(edge => {
      const sourceState = instance.nodeStates[edge.from]
      return sourceState && isNodeCompleted(sourceState)
    })
  }

  // 普通节点：至少一个入边的源节点完成
  return inEdges.some(edge => {
    const sourceState = instance.nodeStates[edge.from]
    return sourceState && isNodeCompleted(sourceState)
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
export function getReadyNodes(
  workflow: Workflow,
  instance: WorkflowInstance
): string[] {
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
  let instance = getInstance(instanceId)

  if (!workflow || !instance) {
    return []
  }

  const node = workflow.nodes.find(n => n.id === nodeId)
  if (!node) {
    return []
  }

  if (result.success) {
    // 标记节点完成
    await markNodeDone(instanceId, nodeId, result.output)

    // 检查是否是 end 节点
    if (node.type === 'end') {
      await completeWorkflowInstance(instanceId)
      return []
    }

    // 特殊处理循环节点
    if (node.type === 'loop' && result.output) {
      const loopOutput = result.output as {
        shouldContinue?: boolean
        bodyNodes?: string[]
      }

      if (loopOutput.shouldContinue && loopOutput.bodyNodes && loopOutput.bodyNodes.length > 0) {
        // 继续循环：保存活跃循环状态，重置并入队循环体入口节点
        instance = getInstance(instanceId)!
        instance.activeLoops = instance.activeLoops || {}
        instance.activeLoops[nodeId] = loopOutput.bodyNodes
        saveInstance(instance)

        // 重置循环体节点状态
        for (const bodyNodeId of loopOutput.bodyNodes) {
          resetNodeState(instanceId, bodyNodeId)
        }

        logger.debug(`Loop node ${nodeId}: continuing with body nodes ${loopOutput.bodyNodes.join(', ')}`)
        // 只入队第一个节点（循环体入口），后续节点通过 edges 连接
        return [loopOutput.bodyNodes[0]!]
      } else {
        // 退出循环：清除活跃循环状态，走正常的 edges
        instance = getInstance(instanceId)!
        if (instance.activeLoops) {
          delete instance.activeLoops[nodeId]
          saveInstance(instance)
        }
        logger.debug(`Loop node ${nodeId}: exiting loop, following normal edges`)
      }
    }

    // 检查当前节点是否属于某个活跃循环
    instance = getInstance(instanceId)!
    const loopNodeId = findParentLoop(nodeId, instance, workflow)
    if (loopNodeId) {
      const loopBodyNodes = instance.activeLoops?.[loopNodeId]
      if (loopBodyNodes) {
        const currentIndex = loopBodyNodes.indexOf(nodeId)
        const isInBodyNodes = currentIndex !== -1
        const isLastBody = isLastBodyNode(nodeId, loopBodyNodes, instance)

        // 检查是否有显式的出边
        const outEdges = workflow.edges.filter(e => e.from === nodeId)
        const hasExplicitEdges = outEdges.length > 0 &&
          !outEdges.every(e => e.to === loopNodeId)

        if (isInBodyNodes && !hasExplicitEdges) {
          if (isLastBody) {
            // 循环体执行完成，重新入队 loop 节点
            logger.debug(`Loop body completed, re-queueing loop node ${loopNodeId}`)
            resetNodeState(instanceId, loopNodeId)
            return [loopNodeId]
          } else {
            // 不是最后一个 body node，按 bodyNodes 顺序执行下一个
            const nextBodyNode = loopBodyNodes[currentIndex + 1]
            if (nextBodyNode) {
              logger.debug(`Loop body continuing: ${nodeId} -> ${nextBodyNode}`)
              return [nextBodyNode]
            }
          }
        }
      }
    }

    // 获取下游节点
    const nextNodes = await getNextNodes(workflowId, instanceId, nodeId)

    // 检查工作流是否完成
    const updatedInstance = getInstance(instanceId)!
    const completion = checkWorkflowCompletion(updatedInstance, workflow)

    if (completion.completed) {
      await completeWorkflowInstance(instanceId)
      return []
    }

    return nextNodes
  } else {
    // 标记节点失败
    await markNodeFailed(instanceId, nodeId, result.error || 'Unknown error')

    // 检查工作流是否应该失败
    const updatedInstance = getInstance(instanceId)!
    const completion = checkWorkflowCompletion(updatedInstance, workflow)

    if (completion.failed) {
      await failWorkflowInstance(instanceId, completion.error || 'Node failed')
    }

    return []
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
function isLastBodyNode(
  nodeId: string,
  bodyNodes: string[],
  instance: WorkflowInstance
): boolean {
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
