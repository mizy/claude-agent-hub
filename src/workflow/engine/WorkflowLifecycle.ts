/**
 * Workflow 生命周期管理
 * 负责工作流和实例的创建、启动、审批等生命周期操作
 */

import { createLogger } from '../../shared/logger.js'
import { generateId } from '../../shared/generateId.js'
import {
  getWorkflow,
  saveWorkflow,
  getInstance,
  createInstance,
} from '../../store/WorkflowStore.js'
import { startWorkflowInstance, markNodeDone } from './StateManager.js'
import { enqueueNodes } from '../queue/WorkflowQueue.js'
import { getNextNodes } from './WorkflowExecution.js'
import type { Workflow, WorkflowInstance } from '../types.js'

const logger = createLogger('workflow-lifecycle')

// ============ 工作流创建与启动 ============

/**
 * 创建并保存工作流
 */
export function createWorkflow(workflow: Omit<Workflow, 'id' | 'createdAt'>): Workflow {
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

// ============ 人工节点审批 ============

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
