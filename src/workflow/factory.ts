/**
 * Workflow factory functions
 *
 * Extracted from types.ts for separation of concerns:
 * types.ts = pure type definitions, factory.ts = object creation
 */

import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowInstance,
  NodeState,
  TaskConfig,
  HumanConfig,
} from './types.js'

function createWorkflowFn(
  name: string,
  description: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): Omit<Workflow, 'id' | 'createdAt'> {
  return {
    name,
    description,
    nodes,
    edges,
    variables: {},
  }
}

function createTaskNodeFn(id: string, name: string, config: TaskConfig): WorkflowNode {
  return {
    id,
    type: 'task',
    name,
    task: config,
  }
}

function createHumanNodeFn(id: string, name: string, config?: HumanConfig): WorkflowNode {
  return {
    id,
    type: 'human',
    name,
    human: config,
  }
}

function createEdgeFn(
  from: string,
  to: string,
  options?: { condition?: string; maxLoops?: number; label?: string }
): Omit<WorkflowEdge, 'id'> {
  return {
    from,
    to,
    ...options,
  }
}

function createInitialNodeStateFn(): NodeState {
  return {
    status: 'pending',
    attempts: 0,
  }
}

function createInitialInstanceFn(
  workflowId: string,
  workflow: Workflow
): Omit<WorkflowInstance, 'id'> {
  const nodeStates: Record<string, NodeState> = {}
  for (const node of workflow.nodes) {
    nodeStates[node.id] = createInitialNodeStateFn()
  }

  return {
    workflowId,
    status: 'pending',
    nodeStates,
    variables: { ...workflow.variables },
    outputs: {},
    loopCounts: {},
  }
}

/**
 * Workflow creation utility collection
 * @example
 * import { WORKFLOW_FACTORY } from './factory.js'
 * const workflow = WORKFLOW_FACTORY.createWorkflow(...)
 */
export const WORKFLOW_FACTORY = {
  createWorkflow: createWorkflowFn,
  createTaskNode: createTaskNodeFn,
  createHumanNode: createHumanNodeFn,
  createEdge: createEdgeFn,
  createInitialNodeState: createInitialNodeStateFn,
  createInitialInstance: createInitialInstanceFn,
}

export const createWorkflow = createWorkflowFn
export const createTaskNode = createTaskNodeFn
export const createHumanNode = createHumanNodeFn
export const createEdge = createEdgeFn
export const createInitialNodeState = createInitialNodeStateFn
export const createInitialInstance = createInitialInstanceFn
