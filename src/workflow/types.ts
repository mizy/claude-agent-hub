/**
 * Workflow 类型定义
 */

// ============ 基础类型 ============

export type NodeType =
  | 'start'
  | 'end'
  | 'task'
  | 'condition'
  | 'parallel'
  | 'join'
  | 'human'
  // 新增节点类型
  | 'delay'
  | 'schedule'
  | 'loop'
  | 'switch'
  | 'assign'
  | 'script'
  | 'foreach'
export type NodeStatus = 'pending' | 'ready' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped'
export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

// ============ Workflow 定义 ============

export interface Workflow {
  id: string
  taskId?: string // 关联的 task ID
  name: string
  description: string
  version?: '1.0' | '2.0' // schema 版本

  nodes: WorkflowNode[]
  edges: WorkflowEdge[]

  variables: Record<string, unknown>

  /** 输入参数定义 */
  inputs?: Array<{
    name: string
    type: 'string' | 'number' | 'boolean' | 'array' | 'object'
    required?: boolean
    default?: unknown
    description?: string
  }>

  /** 输出映射 */
  outputs?: Record<string, string>

  /** 全局设置 */
  settings?: {
    defaultTimeout?: number // 默认节点超时
    maxExecutionTime?: number // 最大总执行时间
    debug?: boolean // 调试模式
  }

  createdAt: string
  updatedAt?: string
  sourceFile?: string
}

export interface WorkflowNode {
  id: string
  type: NodeType
  name: string
  description?: string // 节点描述

  // 现有节点配置
  task?: TaskConfig
  condition?: ConditionConfig
  human?: HumanConfig

  // 新增节点配置
  delay?: DelayConfig
  schedule?: ScheduleConfig
  loop?: LoopConfig
  switch?: SwitchConfig
  assign?: AssignConfig
  script?: ScriptConfig
  foreach?: ForeachConfig

  // 通用选项
  timeout?: number // 超时（毫秒）
  onError?: 'fail' | 'skip' | 'continue' // 错误处理策略
  retry?: {
    maxAttempts: number
    backoffMs?: number
    backoffMultiplier?: number
  }
}

export interface TaskConfig {
  /**
   * Persona 名称引用，用于指定执行此任务时的 AI 角色配置
   * 可以是内置 persona 名称（如 "coder", "reviewer"）或 "auto" 自动选择
   * 对应 PersonaConfig 中的 name 字段
   */
  persona: string
  prompt: string // 任务描述
  timeout?: number // 超时（毫秒），默认 30 分钟
  retries?: number // 重试次数，默认 3
}

export interface ConditionConfig {
  expression: string // 条件表达式
}

export interface HumanConfig {
  assignee?: string // 指定审批人
  timeout?: number // 审批超时（毫秒）
  autoApprove?: boolean // 超时后自动通过
}

// ============ 新增节点配置 ============

/**
 * 延迟节点 - 等待指定时间后继续
 */
export interface DelayConfig {
  value: number // 延迟值
  unit: 's' | 'm' | 'h' | 'd' // 单位：秒/分/时/天
}

/**
 * 定时节点 - 等待到指定时间或 cron 表达式
 */
export interface ScheduleConfig {
  cron?: string // cron 表达式 (e.g., "0 9 * * MON")
  datetime?: string // ISO datetime 字符串
  timezone?: string // 时区 (e.g., "Asia/Shanghai")
}

/**
 * 循环节点 - while/for/until 循环
 */
export interface LoopConfig {
  type: 'while' | 'for' | 'until' // 循环类型
  condition?: string // 条件表达式 (while/until)
  init?: number // 初始值 (for)
  end?: number // 结束值 (for, exclusive)
  step?: number // 步长 (for, default: 1)
  maxIterations?: number // 最大迭代次数 (安全限制)
  loopVar?: string // 循环变量名 (default: 'i')
  bodyNodes: string[] // 循环体节点 ID 列表
}

/**
 * 分支节点 - 多路条件分支
 */
export interface SwitchConfig {
  expression: string // 要计算的表达式
  cases: Array<{
    value: unknown | 'default' // 匹配值或 'default'
    targetNode: string // 目标节点 ID
  }>
  defaultTarget?: string // 默认目标节点
}

/**
 * 赋值节点 - 变量赋值
 */
export interface AssignConfig {
  assignments: Array<{
    variable: string // 变量名 (支持点号表示嵌套)
    value: unknown // 值或表达式
    isExpression?: boolean // true 表示 value 是表达式
  }>
}

/**
 * 脚本节点 - 执行表达式计算
 *
 * 支持两种模式：
 * 1. 单表达式模式：expression + outputVar
 * 2. 多赋值模式：assignments（类似 assign 节点）
 */
export interface ScriptConfig {
  expression?: string // 要执行的表达式（单表达式模式）
  outputVar?: string // 结果存储的变量名（单表达式模式）
  /** 多变量赋值（类似 assign 节点，支持表达式） */
  assignments?: Array<{
    variable: string // 变量名
    expression: string // 表达式
  }>
}

/**
 * 遍历节点 - 对集合执行子流程
 */
export interface ForeachConfig {
  collection: string // 集合表达式
  itemVar?: string // 当前项变量名 (default: 'item')
  indexVar?: string // 索引变量名 (default: 'index')
  bodyNodes: string[] // 循环体节点 ID 列表
  maxIterations?: number // 最大迭代次数
  mode?: 'sequential' | 'parallel' // 执行模式
  maxParallel?: number // 最大并行数 (parallel 模式)
}

export interface WorkflowEdge {
  id: string
  from: string
  to: string
  condition?: string // 边上的条件表达式
  maxLoops?: number // 最大循环次数（用于有环图）
  label?: string // 边标签（用于显示）
}

// ============ 运行时状态 ============

export interface WorkflowInstance {
  id: string
  workflowId: string
  status: WorkflowStatus

  nodeStates: Record<string, NodeState>
  variables: Record<string, unknown>
  outputs: Record<string, unknown>

  loopCounts: Record<string, number> // edge-id → 循环次数

  // 活跃循环追踪: loopNodeId → bodyNodes
  activeLoops?: Record<string, string[]>

  startedAt?: string
  completedAt?: string
  error?: string
}

export interface NodeState {
  status: NodeStatus
  startedAt?: string
  completedAt?: string
  error?: string
  attempts: number
  /** 执行耗时（毫秒），用于历史分析和时间预估 */
  durationMs?: number
  /** 最后一次错误的分类（transient/recoverable/permanent） */
  lastErrorCategory?: 'transient' | 'recoverable' | 'permanent' | 'unknown'
  /** 执行上下文快照，用于断点续跑诊断 */
  context?: {
    /** 执行时的 workflow 变量快照 */
    variables?: Record<string, unknown>
    /** 上游节点输出快照 */
    inputs?: Record<string, unknown>
    /** 最后一次重试的延迟时间 */
    lastRetryDelayMs?: number
  }
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
  /** 当前循环上下文 (loop/foreach 节点) */
  loopContext?: {
    index: number
    item?: unknown
    total?: number
  }
  /** 工作流输入参数 */
  inputs?: Record<string, unknown>
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
  | 'node:waiting' // human 节点等待审批

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

// Factory functions extracted to ./factory.ts
export {
  WORKFLOW_FACTORY,
  createWorkflow,
  createTaskNode,
  createHumanNode,
  createEdge,
  createInitialNodeState,
  createInitialInstance,
} from './factory.js'
