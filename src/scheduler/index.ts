/**
 * @entry Scheduler 调度模块
 *
 * 守护进程、事件总线、任务队列、Worker 管理
 *
 * 能力分组：
 * - 事件总线: eventBus/emitEvent/onEvent（SchedulerEvents 类型）
 * - 队列: createQueue/createDelayedQueue（优先级队列 + 延迟队列）
 * - Worker: createWorker（含状态、并发配置、任务处理回调）
 * - 守护进程: startDaemon/stopDaemon/restartDaemon/getDaemonStatus
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
