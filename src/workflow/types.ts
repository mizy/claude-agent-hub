/**
 * Workflow 类型定义
 */

// ============ 基础类型 ============

export type NodeType = 'start' | 'end' | 'task' | 'condition' | 'parallel' | 'join' | 'human'
export type NodeStatus = 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'skipped'
export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

// ============ Workflow 定义 ============

export interface Workflow {
  id: string
  name: string
  description: string

  nodes: WorkflowNode[]
  edges: WorkflowEdge[]

  variables: Record<string, unknown>

  createdAt: string
  sourceFile?: string
}

export interface WorkflowNode {
  id: string
  type: NodeType
  name: string

  // task 节点配置
  task?: TaskConfig

  // condition 节点配置
  condition?: ConditionConfig

  // human 节点配置
  human?: HumanConfig
}

export interface TaskConfig {
  agent: string         // Agent 名称或 "auto"
  prompt: string        // 任务描述
  timeout?: number      // 超时（毫秒），默认 30 分钟
  retries?: number      // 重试次数，默认 3
}

export interface ConditionConfig {
  expression: string    // 条件表达式
}

export interface HumanConfig {
  assignee?: string     // 指定审批人
  timeout?: number      // 审批超时（毫秒）
  autoApprove?: boolean // 超时后自动通过
}

export interface WorkflowEdge {
  id: string
  from: string
  to: string
  condition?: string    // 边上的条件表达式
  maxLoops?: number     // 最大循环次数（用于有环图）
  label?: string        // 边标签（用于显示）
}

// ============ 运行时状态 ============

export interface WorkflowInstance {
  id: string
  workflowId: string
  status: WorkflowStatus

  nodeStates: Record<string, NodeState>
  variables: Record<string, unknown>
  outputs: Record<string, unknown>

  loopCounts: Record<string, number>  // edge-id → 循环次数

  startedAt?: string
  completedAt?: string
  error?: string
}

export interface NodeState {
  status: NodeStatus
  startedAt?: string
  completedAt?: string
  result?: unknown
  error?: string
  attempts: number
}

// ============ BullMQ Job 数据 ============

export interface NodeJobData {
  workflowId: string
  instanceId: string
  nodeId: string
  attempt: number
}

export interface NodeJobResult {
  success: boolean
  output?: unknown
  error?: string
  nextNodes?: string[]
}

// ============ 条件求值上下文 ============

export interface EvalContext {
  outputs: Record<string, unknown>
  variables: Record<string, unknown>
  loopCount: number
  nodeStates: Record<string, NodeState>
}

// ============ 事件类型 ============

export type WorkflowEventType =
  | 'workflow:started'
  | 'workflow:completed'
  | 'workflow:failed'
  | 'workflow:paused'
  | 'workflow:resumed'
  | 'workflow:cancelled'
  | 'node:started'
  | 'node:completed'
  | 'node:failed'
  | 'node:skipped'
  | 'node:waiting'  // human 节点等待审批

export interface WorkflowEvent {
  type: WorkflowEventType
  workflowId: string
  instanceId: string
  nodeId?: string
  timestamp: string
  data?: unknown
}

// ============ 工具函数类型 ============

export interface ExecuteNodeResult {
  success: boolean
  output?: unknown
  error?: string
}

// ============ 创建工作流的辅助函数 ============

export function createWorkflow(
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

export function createTaskNode(
  id: string,
  name: string,
  config: TaskConfig
): WorkflowNode {
  return {
    id,
    type: 'task',
    name,
    task: config,
  }
}

export function createHumanNode(
  id: string,
  name: string,
  config?: HumanConfig
): WorkflowNode {
  return {
    id,
    type: 'human',
    name,
    human: config,
  }
}

export function createEdge(
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

// ============ 初始状态 ============

export function createInitialNodeState(): NodeState {
  return {
    status: 'pending',
    attempts: 0,
  }
}

export function createInitialInstance(
  workflowId: string,
  workflow: Workflow
): Omit<WorkflowInstance, 'id'> {
  const nodeStates: Record<string, NodeState> = {}
  for (const node of workflow.nodes) {
    nodeStates[node.id] = createInitialNodeState()
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
