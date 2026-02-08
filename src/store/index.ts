/**
 * @entry Store 存储模块
 *
 * 提供文件存储、任务持久化和日志管理能力
 *
 * 主要 API:
 * - FileStore<T>: 泛型 key-value 文件存储类
 * - getStore(): 获取统一存储接口实例
 * - saveTask/getTask: 任务 CRUD
 * - saveWorkflow/getInstance: Workflow 存储
 * - appendExecutionLog: 日志写入
 */

// 路径常量和构建函数
export * from './paths.js'

// JSON 读写工具
export * from './readWriteJson.js'

// 类型定义
export * from './types.js'

// ============ 泛型文件存储类 ============
// FileStore<T, S> 是一个通用的 key-value 文件存储工具类
// 支持文件模式和目录模式，可选的 Summary 转换和 Query 过滤
export {
  FileStore,
  type FileStoreOptions,
  type QueryFilter,
  type StoreMode,
} from './GenericFileStore.js'

// TaskStore - Task CRUD 和进程管理
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
  // Process info
  saveProcessInfo,
  getProcessInfo,
  updateProcessInfo,
  isProcessRunning,
  // Types
  type TaskSummary,
  type ProcessInfo,
  type ProcessStopReason,
} from './TaskStore.js'

// TaskWorkflowStore - Task 的 Workflow 和 Instance 存储
export {
  // Workflow in task folder
  saveTaskWorkflow,
  getTaskWorkflow,
  saveTaskInstance,
  getTaskInstance,
  // Path helpers
  getWorkflowPath,
  getInstancePath,
  // Load full folder
  loadTaskFolder,
  // Types
  type TaskFolder,
} from './TaskWorkflowStore.js'

// TaskLogStore - Task 的日志和步骤输出
export {
  // Conversation logging
  appendConversation,
  getConversationLogPath,
  // Execution log
  appendExecutionLog,
  // JSON Lines log
  appendJsonlLog,
  type JsonlLogEntry,
  type LogEventType,
  // Path helpers
  getLogPath,
  getOutputPath,
  // Types
  type ConversationEntry,
  type ExecutionLogOptions,
} from './TaskLogStore.js'

// ============ 统一存储接口 ============
// UnifiedStore 提供 Task, Workflow 的存储操作方法
// 使用 getStore() 获取单例实例
// 注意：队列操作请直接使用 workflow/queue/WorkflowQueue.js
export { getStore, type UnifiedStore } from './UnifiedStore.js'

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

// ExecutionStatsStore - 执行统计和时间线
export {
  // Stats
  saveExecutionStats,
  getExecutionStats,
  formatExecutionSummary,
  // Timeline
  appendTimelineEvent,
  getExecutionTimeline,
  getTimelineForInstance,
  clearTimelineForNewInstance,
  formatTimeline,
  // Types
  type ExecutionTimeline,
  type ExecutionSummary,
} from './ExecutionStatsStore.js'
