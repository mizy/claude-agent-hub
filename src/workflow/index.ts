/**
 * Workflow 模块统一导出
 *
 * 常用 API 从这里导入，完整功能请使用子模块：
 * - workflow/engine: 引擎核心、状态管理、条件求值
 * - workflow/queue: 任务队列、Worker
 * - workflow/parser: Markdown/JSON 解析器
 * - workflow/types: 完整类型定义
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
export {
  createInitialNodeState,
  createInitialInstance,
} from './types.js'

// ============ 引擎核心 ============

// Workflow 创建和启动
export {
  createWorkflow,
  startWorkflow,
  handleNodeResult,
} from './engine/WorkflowEngine.js'

// 状态管理（常用）
export {
  recoverWorkflowInstance,
  markNodeRunning,
  markNodeDone,
  markNodeFailed,
  getWorkflowProgress,
} from './engine/StateManager.js'

// ============ 存储 ============

export {
  saveWorkflow,
  getWorkflow,
  createInstance,
  saveInstance,
  getInstance,
  updateNodeState,
  setNodeOutput,
} from '../store/WorkflowStore.js'

// ============ 队列（常用） ============

export {
  enqueueNode,
  enqueueNodes,
  getQueueStats,
  closeQueue,
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

export {
  parseJson,
  validateJsonWorkflow,
  extractJson,
} from './parser/parseJson.js'

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
