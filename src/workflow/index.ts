/**
 * Workflow 模块统一导出
 */

// 类型
export * from './types.js'

// 引擎
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

// 存储
export {
  saveWorkflow,
  getWorkflow,
  getAllWorkflows,
  deleteWorkflow,
  createInstance,
  saveInstance,
  getInstance,
  getInstancesByWorkflow,
  getInstancesByStatus,
  getAllInstances,
  updateInstanceStatus,
  updateNodeState,
  setNodeOutput,
  incrementLoopCount,
  resetNodeState,
  updateInstanceVariables,
} from './store/WorkflowStore.js'

// 队列（SQLite-based）
export {
  enqueueNode,
  enqueueNodes,
  getQueueStats,
  drainQueue,
  closeQueue,
  removeWorkflowJobs,
  getNextJob,
  completeJob,
  failJob,
  getWaitingJobs,
  cleanupOldJobs,
} from './queue/WorkflowQueue.js'

// Worker
export {
  createNodeWorker,
  getNodeWorker,
  startWorker,
  pauseWorker,
  resumeWorker,
  closeWorker,
  isWorkerRunning,
  type NodeProcessor,
  type WorkerOptions,
} from './queue/NodeWorker.js'

// 解析器
export {
  parseMarkdown,
  validateMarkdown,
} from './parser/parseMarkdown.js'

export {
  parseJson,
  validateJsonWorkflow,
  extractJson,
} from './parser/parseJson.js'

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
} from './engine/executeNewNodes.js'
