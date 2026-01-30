/**
 * Scheduler 模块统一导出
 */

// 事件总线
export {
  type EventHandler,
  type SchedulerEvents,
  eventBus,
  emitEvent,
  onEvent,
} from './eventBus.js'

// 任务队列
export {
  type Priority,
  type QueueItem,
  type Queue,
  type DelayedQueue,
  createQueue,
  createDelayedQueue,
} from './queue.js'

// Worker
export {
  type WorkerStatus,
  type WorkerConfig,
  type Worker,
  type WorkerContext,
  type TaskHandler,
  type AgentTask,
  type AgentTaskResult,
  createWorker,
  createAgentWorker,
} from './worker.js'

// 守护进程（原有）
export { startDaemon } from './startDaemon.js'
export { stopDaemon } from './stopDaemon.js'
export { getDaemonStatus } from './getDaemonStatus.js'
