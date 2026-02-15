/**
 * Dynamic node injection into running workflows
 */

import { getTask } from '../store/TaskStore.js'
import { getTaskInstance, getTaskWorkflow, saveTaskWorkflow } from '../store/TaskWorkflowStore.js'
import { saveInstance } from '../store/WorkflowStore.js'
import { appendExecutionLog, appendJsonlLog } from '../store/TaskLogStore.js'
import { createLogger } from '../shared/logger.js'
import { generateId } from '../shared/generateId.js'
import { isTerminalStatus } from '../types/taskStatus.js'

const logger = createLogger('task')

export interface InjectNodeResult {
  success: boolean
  nodeId?: string
  error?: string
}

/**
 * Inject a new task node into a running workflow.
 * The new node is inserted after the currently running/latest completed node
 * and before its downstream nodes.
 */
export function injectNode(taskId: string, nodePrompt: string, persona = 'Pragmatist'): InjectNodeResult {
  const task = getTask(taskId)
  if (!task) {
    return { success: false, error: `Task not found: ${taskId}` }
  }

  if (isTerminalStatus(task.status)) {
    return { success: false, error: `Task is already ${task.status}` }
  }

  const workflow = getTaskWorkflow(taskId)
  const instance = getTaskInstance(taskId)

  if (!workflow || !instance) {
    return { success: false, error: 'No workflow or instance found for this task' }
  }

  // Find the "anchor" node: the currently running node, or the last completed node
  let anchorNodeId: string | null = null

  // First try to find a running node
  for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
    if (state.status === 'running') {
      anchorNodeId = nodeId
      break
    }
  }

  // If no running node, find the most recently completed node (by completedAt)
  if (!anchorNodeId) {
    let latestTime = 0
    for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
      if (state.status === 'done' && state.completedAt) {
        const time = new Date(state.completedAt).getTime()
        if (time > latestTime) {
          latestTime = time
          anchorNodeId = nodeId
        }
      }
    }
  }

  if (!anchorNodeId) {
    return { success: false, error: 'No running or completed node found to inject after' }
  }

  // Create new node
  const newNodeId = `injected-${generateId().slice(0, 8)}`
  const newNode = {
    id: newNodeId,
    type: 'task' as const,
    name: `[注入] ${nodePrompt.slice(0, 30)}`,
    description: nodePrompt,
    task: {
      persona,
      prompt: nodePrompt,
    },
  }

  // Find edges going out from anchor node
  const outEdges = workflow.edges.filter(e => e.from === anchorNodeId)

  // Re-wire: anchor → newNode → (original targets)
  // Remove old edges from anchor
  workflow.edges = workflow.edges.filter(e => e.from !== anchorNodeId)

  // Add edge: anchor → newNode
  workflow.edges.push({
    id: `edge-${generateId().slice(0, 8)}`,
    from: anchorNodeId,
    to: newNodeId,
  })

  // Add edges: newNode → each original target
  for (const edge of outEdges) {
    workflow.edges.push({
      id: `edge-${generateId().slice(0, 8)}`,
      from: newNodeId,
      to: edge.to,
      condition: edge.condition,
    })
  }

  // Add node to workflow
  workflow.nodes.push(newNode)

  // Add node state to instance
  instance.nodeStates[newNodeId] = { status: 'pending', attempts: 0 }

  // Save both
  saveTaskWorkflow(taskId, workflow)
  saveInstance(instance)

  logger.info(`Injected node ${newNodeId} into task ${taskId} after ${anchorNodeId}`)

  appendExecutionLog(taskId, `Node injected: ${newNode.name} (after ${anchorNodeId})`, { scope: 'lifecycle' })
  appendJsonlLog(taskId, {
    event: 'node_injected',
    message: `Node injected: ${newNode.name}`,
    data: { nodeId: newNodeId, afterNode: anchorNodeId, prompt: nodePrompt },
  })

  return { success: true, nodeId: newNodeId }
}
