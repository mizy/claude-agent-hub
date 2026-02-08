/**
 * @entry Workflow 工作流引擎模块
 *
 * 提供工作流定义、执行和状态管理能力
 *
 * 主要 API:
 * - createWorkflow(): 创建工作流
 * - startWorkflow(): 启动工作流
 * - handleNodeResult(): 处理节点执行结果
 * - enqueueNodes(): 入队节点
 *
 * 子模块:
 * - workflow/engine: 引擎核心、状态管理
 * - workflow/queue: 任务队列、Worker
 * - workflow/parser: JSON 解析器
 */

// ============ 核心类型 ============

export type {
  // 基础类型
  NodeType,
  NodeStatus,
  WorkflowStatus,
  // 主要结构
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowInstance,
  NodeState,
  // 配置类型
  TaskConfig,
  ConditionConfig,
  HumanConfig,
  // 运行时类型
  NodeJobData,
  NodeJobResult,
  EvalContext,
  ExecuteNodeResult,
} from './types.js'

// 类型辅助函数
export { createInitialNodeState, createInitialInstance } from './types.js'

// ============ 引擎核心 ============

// Workflow 创建和启动
export { createWorkflow, startWorkflow, handleNodeResult } from './engine/WorkflowEngine.js'

// 状态管理（常用）
export {
  recoverWorkflowInstance,
  markNodeRunning,
  markNodeDone,
  markNodeFailed,
  getWorkflowProgress,
} from './engine/StateManager.js'

// ============ 队列（常用） ============

export {
  enqueueNode,
  enqueueNodes,
  getQueueStats,
  closeQueue,
  getWaitingHumanJobs,
  resumeWaitingJob,
  markJobFailed,
} from './queue/WorkflowQueue.js'

// Worker
export {
  createNodeWorker,
  startWorker,
  closeWorker,
  isWorkerRunning,
  type NodeProcessor,
  type WorkerOptions,
} from './queue/NodeWorker.js'

// ============ 解析器 ============

export { parseJson, validateJsonWorkflow, extractJson } from './parser/parseJson.js'

// ============ 事件系统 ============

export {
  workflowEvents,
  type WorkflowEventEmitter,
  type NodeStartedEvent,
  type NodeCompletedEvent,
  type NodeFailedEvent,
  type WorkflowStartedEvent,
  type WorkflowCompletedEvent,
  type WorkflowFailedEvent,
  type WorkflowProgressEvent,
  type NodeExecutionStats,
  type WorkflowExecutionStats,
} from './engine/WorkflowEventEmitter.js'
