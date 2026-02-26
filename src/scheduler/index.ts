/**
 * @entry Scheduler 调度模块
 *
 * 提供任务队列、Worker 和守护进程管理能力
 *
 * 主要 API:
 * - createQueue(): 创建任务队列
 * - createWorker(): 创建 Worker
 * - startDaemon(): 启动守护进程
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
} from './createQueue.js'

// Worker
export {
  type WorkerStatus,
  type WorkerConfig,
  type Worker,
  type WorkerContext,
  type TaskHandler,
  createWorker,
} from './createWorker.js'

// 守护进程
export { startDaemon } from './startDaemon.js'
export { stopDaemon } from './stopDaemon.js'
export { restartDaemon } from './restartDaemon.js'
export { getDaemonStatus } from './getDaemonStatus.js'
