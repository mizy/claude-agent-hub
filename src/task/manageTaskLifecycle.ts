/**
 * Task lifecycle management — re-export entry point
 *
 * Split into:
 * - deleteTask.ts — delete/clear operations
 * - stopTask.ts — stop/kill operations
 * - completeTask.ts — complete/reject operations
 * - pauseResumeTask.ts — pause/resume operations
 * - injectNode.ts — dynamic node injection
 */

export { deleteTask, clearTasks, type DeleteTaskResult, type ClearTasksResult } from './deleteTask.js'
export { stopTask, type StopTaskResult } from './stopTask.js'
export { completeTask, rejectTask, type CompleteTaskResult } from './completeTask.js'
export { pauseTask, resumePausedTask, type PauseTaskResult } from './pauseResumeTask.js'
export { injectNode, type InjectNodeResult } from './injectNode.js'
