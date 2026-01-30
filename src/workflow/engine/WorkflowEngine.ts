/**
 * Workflow 引擎核心
 * @entry
 */

import { createLogger } from '../../shared/logger.js'
import { generateId } from '../../shared/id.js'
import {
  getWorkflow,
  saveWorkflow,
  getInstance,
  createInstance,
  incrementLoopCount,
  resetNodeState,
} from '../store/WorkflowStore.js'
import {
  startWorkflowInstance,
  markNodeReady,
  markNodeRunning,
  markNodeDone,
  markNodeFailed,
  markNodeSkipped,
  completeWorkflowInstance,
  failWorkflowInstance,
  isNodeCompleted,
  checkWorkflowCompletion,
} from './StateManager.js'
import { evaluateCondition } from './ConditionEvaluator.js'
import { enqueueNode, enqueueNodes } from '../queue/WorkflowQueue.js'
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowInstance,
  NodeJobData,
  EvalContext,
  ExecuteNodeResult,
} from '../types.js'

const logger = createLogger('workflow-engine')

// ============ 工作流创建与启动 ============

/**
 * 创建并保存工作流
 */
export function createWorkflow(
  workflow: Omit<Workflow, 'id' | 'createdAt'>
): Workflow {
  const fullWorkflow: Workflow = {
    ...workflow,
    id: generateId(),
    createdAt: new Date().toISOString(),
  }

  saveWorkflow(fullWorkflow)
  logger.info(`Created workflow: ${fullWorkflow.id} (${fullWorkflow.name})`)

  return fullWorkflow
}

/**
 * 启动工作流执行
 */
export async function startWorkflow(workflowId: string): Promise<WorkflowInstance> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`)
  }

  // 创建实例
  const instance = createInstance(workflowId)

  // 标记为运行中
  await startWorkflowInstance(instance.id)

  // 找到 start 节点
  const startNode = workflow.nodes.find(n => n.type === 'start')
  if (!startNode) {
    throw new Error('Workflow has no start node')
  }

  // 标记 start 节点完成
  await markNodeDone(instance.id, startNode.id)

  // 获取 start 的下游节点并入队
  const nextNodes = await getNextNodes(workflowId, instance.id, startNode.id)

  if (nextNodes.length > 0) {
    await enqueueNodes(
      nextNodes.map(nodeId => ({
        data: {
          workflowId,
          instanceId: instance.id,
          nodeId,
          attempt: 1,
        },
      }))
    )
  }

  logger.info(`Started workflow: ${workflowId}, instance: ${instance.id}`)

  return getInstance(instance.id)!
}

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
  workflow: Workflow
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

  // 获取所有入边
  const inEdges = workflow.edges.filter(e => e.to === nodeId)

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
  const instance = getInstance(instanceId)

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

// ============ 并行网关处理 ============

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

// ============ 人工节点处理 ============

/**
 * 审批通过
 */
export async function approveHumanNode(
  workflowId: string,
  instanceId: string,
  nodeId: string,
  output?: unknown
): Promise<string[]> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`)
  }

  const node = workflow.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'human') {
    throw new Error(`Node ${nodeId} is not a human node`)
  }

  // 标记通过，输出包含 approved: true
  const approvalOutput = {
    approved: true,
    ...((typeof output === 'object' && output) || {}),
  }

  await markNodeDone(instanceId, nodeId, approvalOutput)

  // 获取下游节点并入队
  const nextNodes = await getNextNodes(workflowId, instanceId, nodeId)

  if (nextNodes.length > 0) {
    await enqueueNodes(
      nextNodes.map(nextNodeId => ({
        data: {
          workflowId,
          instanceId,
          nodeId: nextNodeId,
          attempt: 1,
        },
      }))
    )
  }

  logger.info(`Human node approved: ${nodeId}`)

  return nextNodes
}

/**
 * 审批驳回
 */
export async function rejectHumanNode(
  workflowId: string,
  instanceId: string,
  nodeId: string,
  reason?: string
): Promise<string[]> {
  const workflow = getWorkflow(workflowId)
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`)
  }

  const node = workflow.nodes.find(n => n.id === nodeId)
  if (!node || node.type !== 'human') {
    throw new Error(`Node ${nodeId} is not a human node`)
  }

  // 标记驳回，输出包含 approved: false
  const rejectOutput = {
    approved: false,
    reason: reason || 'Rejected',
  }

  await markNodeDone(instanceId, nodeId, rejectOutput)

  // 获取下游节点（会走驳回的边）并入队
  const nextNodes = await getNextNodes(workflowId, instanceId, nodeId)

  if (nextNodes.length > 0) {
    await enqueueNodes(
      nextNodes.map(nextNodeId => ({
        data: {
          workflowId,
          instanceId,
          nodeId: nextNodeId,
          attempt: 1,
        },
      }))
    )
  }

  logger.info(`Human node rejected: ${nodeId} - ${reason}`)

  return nextNodes
}
