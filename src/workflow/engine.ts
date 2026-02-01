/**
 * Workflow 引擎模块导出
 * 包含引擎核心、状态管理、条件求值、节点执行器
 */

// 引擎核心
export {
  createWorkflow,
  startWorkflow,
  getNextNodes,
  canExecuteNode,
  getReadyNodes,
  handleNodeResult,
  handleParallelGateway,
  handleJoinGateway,
  approveHumanNode,
  rejectHumanNode,
} from './engine/WorkflowEngine.js'

// 状态管理
export {
  startWorkflowInstance,
  pauseWorkflowInstance,
  resumeWorkflowInstance,
  completeWorkflowInstance,
  failWorkflowInstance,
  cancelWorkflowInstance,
  recoverWorkflowInstance,
  markNodeReady,
  markNodeRunning,
  markNodeDone,
  markNodeFailed,
  markNodeSkipped,
  isNodeCompleted,
  isNodeRunnable,
  getActiveNodes,
  getPendingNodes,
  getCompletedNodes,
  getFailedNodes,
  checkWorkflowCompletion,
  getWorkflowProgress,
} from './engine/StateManager.js'

// 条件求值
export {
  evaluateCondition,
  validateExpression,
  extractVariables,
} from './engine/ConditionEvaluator.js'

// 新节点执行器
export {
  evaluateExpression,
  executeDelayNode,
  executeScheduleNode,
  executeSwitchNode,
  executeAssignNode,
  executeScriptNode,
  executeLoopNode,
  executeForeachNode,
  type DelayResult,
  type ScheduleResult,
  type SwitchResult,
  type AssignResult,
  type ScriptResult,
  type LoopResult,
  type ForeachResult,
} from './engine/executeNewNodes.js'
