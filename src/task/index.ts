/**
 * @entry Task 任务管理模块
 *
 * 任务全生命周期：创建、执行、查询、暂停/恢复、停止、审批、孤儿检测
 *
 * 能力分组：
 * - 创建: createTask/createAndRunTask
 * - 执行: executeTask/runTask/resumeTask/waitForWorkflowCompletion/setupIncrementalStatsSaving
 * - 查询: listTasks/getTaskDetail/pollPendingTask/getAllTasks
 * - 生命周期: stopTask/deleteTask/clearTasks/completeTask/rejectTask/pauseTask/resumePausedTask/injectNode
 * - 孤儿检测: detectOrphanedTasks/resumeOrphanedTask/resumeAllOrphanedTasks/getOrphanedTasksSummary
 * - Store 透传: getTask/getTaskFolder/getTaskWorkflow/getTaskInstance/getLogPath/getOutputPath/
 *   getExecutionStats/getExecutionTimeline/formatExecutionSummary/formatTimeline
 */

// Core task creation
export { createTask } from './createTask.js'

// Task lifecycle (delete, clear, stop, complete, reject, pause, resume, inject)
export {
  deleteTask,
  clearTasks,
  stopTask,
  completeTask,
  rejectTask,
  pauseTask,
  resumePausedTask,
  injectNode,
  type DeleteTaskResult,
  type ClearTasksResult,
  type StopTaskResult,
  type CompleteTaskResult,
  type PauseTaskResult,
  type InjectNodeResult,
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
export { getTask, getTaskFolder } from '../store/TaskStore.js'
export { getTaskWorkflow, getTaskInstance } from '../store/TaskWorkflowStore.js'
export { getLogPath, getOutputPath } from '../store/TaskLogStore.js'
export {
  getExecutionStats,
  getExecutionTimeline,
  formatExecutionSummary,
  formatTimeline,
  type ExecutionSummary,
  type ExecutionTimeline,
} from '../store/ExecutionStatsStore.js'
