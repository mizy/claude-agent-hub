/**
 * 统一存储模块入口
 *
 * 导出所有存储相关的类型、工具和类。
 */

// 路径常量和构建函数
export * from './paths.js'

// JSON 读写工具
export * from './json.js'

// 类型定义
export * from './types.js'

// 泛型文件存储类
export { FileStore, type FileStoreOptions } from './GenericFileStore.js'

// TaskStore - 任务存储
export {
  // Task CRUD
  saveTask,
  getTask,
  getAllTasks,
  getAllTaskSummaries,
  getTasksByStatus,
  getTaskSummariesByStatus,
  updateTask,
  deleteTask,
  // Task folder
  generateTaskId,
  createTaskFolder,
  getTaskFolder,
  getTaskFolderByStatus,
  loadTaskFolder,
  // Workflow in task folder
  saveTaskWorkflow,
  getTaskWorkflow,
  saveTaskInstance,
  getTaskInstance,
  // Process info
  saveProcessInfo,
  getProcessInfo,
  updateProcessInfo,
  isProcessRunning,
  // Step records
  saveStepOutput,
  // Logs
  appendConversation,
  appendExecutionLog,
  getLogPath,
  getOutputPath,
  getWorkflowPath,
  getInstancePath,
  getConversationLogPath,
  // Types
  type TaskSummary,
  type ProcessInfo,
  type TaskFolder,
  type ConversationEntry,
} from './TaskStore.js'

// 统一存储接口和实现
export {
  getStore,
  type UnifiedStore,
  type TaskQueueItem,
  type QueueStatus,
} from './fileStore.js'

// WorkflowStore - Workflow 和 Instance 存储
export {
  // Workflow CRUD
  saveWorkflow,
  getWorkflow,
  getAllWorkflows,
  deleteWorkflow,
  // Instance CRUD
  createInstance,
  saveInstance,
  getInstance,
  getInstancesByWorkflow,
  getInstancesByStatus,
  getAllInstances,
  // Instance 状态更新
  updateInstanceStatus,
  updateNodeState,
  setNodeOutput,
  incrementLoopCount,
  resetNodeState,
  updateInstanceVariables,
} from './WorkflowStore.js'
