/**
 * Workflow 引擎核心
 * @entry 统一导出工作流引擎的所有功能
 *
 * 核心职责:
 * - 工作流生命周期管理（创建、启动、审批）
 * - 节点调度与执行（调度、结果处理）
 * - 网关和控制流（并行、汇聚、循环）
 *
 * 模块组成:
 * - WorkflowLifecycle: 生命周期管理
 * - WorkflowExecution: 执行逻辑
 * - StateManager: 状态管理
 * - ConditionEvaluator: 条件求值
 */

// ============ 统一导出 ============

// 生命周期管理
export {
  createWorkflow,
  startWorkflow,
  approveHumanNode,
  rejectHumanNode,
} from './WorkflowLifecycle.js'

// 执行逻辑
export {
  getNextNodes,
  canExecuteNode,
  getReadyNodes,
  handleNodeResult,
  handleParallelGateway,
  handleJoinGateway,
} from './WorkflowExecution.js'

// 状态管理
export {
  markNodeRunning,
  markNodeDone,
  markNodeFailed,
  startWorkflowInstance,
  completeWorkflowInstance,
  failWorkflowInstance,
  isNodeCompleted,
  checkWorkflowCompletion,
} from './StateManager.js'

// 条件求值
export { evaluateCondition } from './ExpressionEvaluator.js'
