/**
 * 任务状态类型安全辅助函数
 *
 * 提供类型安全的任务状态判断，避免字符串字面量散落在代码各处
 */

import type { TaskStatus } from './task.js'

/** 运行中状态（正在执行的任务） */
const RUNNING_STATUSES: readonly TaskStatus[] = ['planning', 'developing'] as const

/** 活跃状态（未完成的任务） */
const ACTIVE_STATUSES: readonly TaskStatus[] = [
  'pending',
  'planning',
  'developing',
  'reviewing',
] as const

/** 终结状态（已结束的任务） */
const TERMINAL_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled'] as const

/** 可停止的状态 */
const STOPPABLE_STATUSES: readonly TaskStatus[] = [
  'pending',
  'planning',
  'developing',
  'reviewing',
] as const

/**
 * 判断任务是否正在执行中
 */
export function isRunningStatus(status: TaskStatus): boolean {
  return (RUNNING_STATUSES as readonly string[]).includes(status)
}

/**
 * 判断任务是否处于活跃状态（未终结）
 */
export function isActiveStatus(status: TaskStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status)
}

/**
 * 判断任务是否已终结
 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

/**
 * 判断任务是否待处理
 */
export function isPendingStatus(status: TaskStatus): boolean {
  return status === 'pending'
}

/**
 * 判断任务是否已完成（成功）
 */
export function isCompletedStatus(status: TaskStatus): boolean {
  return status === 'completed'
}

/**
 * 判断任务是否失败
 */
export function isFailedStatus(status: TaskStatus): boolean {
  return status === 'failed'
}

/**
 * 判断任务是否已取消
 */
export function isCancelledStatus(status: TaskStatus): boolean {
  return status === 'cancelled'
}

/**
 * 判断任务是否处于评审中
 */
export function isReviewingStatus(status: TaskStatus): boolean {
  return status === 'reviewing'
}

/**
 * 判断任务是否可以被停止
 */
export function isStoppableStatus(status: TaskStatus): boolean {
  return (STOPPABLE_STATUSES as readonly string[]).includes(status)
}
