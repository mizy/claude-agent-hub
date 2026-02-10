/**
 * @entry Task 任务管理模块
 *
 * 提供任务的创建、执行、查询和生命周期管理能力
 *
 * 主要 API:
 * - createTask(): 创建任务
 * - executeTask(): 执行任务
 * - listTasks(): 列出任务
 * - stopTask(): 停止任务
 */

// Core task creation
export { createTask } from './createTask.js'

// Task lifecycle (delete, clear, stop, complete, reject)
export {
  deleteTask,
  clearTasks,
  stopTask,
  completeTask,
  rejectTask,
  type DeleteTaskResult,
  type ClearTasksResult,
  type StopTaskResult,
  type CompleteTaskResult,
} from './manageTaskLifecycle.js'

// Task query (list, detail, poll)
export {
  listTasks,
  getTaskDetail,
  pollPendingTask,
  getAllTasks,
  type ListOptions,
} from './queryTask.js'

// Task execution
export { createAndRunTask } from './createAndRun.js'
export {
  detectOrphanedTasks,
  resumeTask as resumeOrphanedTask,
  resumeAllOrphanedTasks,
  getOrphanedTasksSummary,
  type OrphanedTask,
} from './resumeTask.js'

// Core task execution
export { executeTask, type ExecuteTaskOptions, type ExecuteTaskResult } from './executeTask.js'
export { runTask, resumeTask } from './runTask.js'

// Execution utilities
export { waitForWorkflowCompletion, createProgressBar } from './ExecutionProgress.js'
export { setupIncrementalStatsSaving } from './ExecutionStats.js'

// Task data access (re-exported from store for upper layers)
// Upper layers (CLI, Server, Report) should use these instead of importing store directly
export { getTask, getTaskFolder, getProcessInfo, isProcessRunning } from '../store/TaskStore.js'
export { getTaskWorkflow, getTaskInstance, loadTaskFolder } from '../store/TaskWorkflowStore.js'
export { getLogPath, getOutputPath } from '../store/TaskLogStore.js'
export {
  getExecutionStats,
  getExecutionTimeline,
  formatExecutionSummary,
  formatTimeline,
  type ExecutionSummary,
  type ExecutionTimeline,
} from '../store/ExecutionStatsStore.js'
