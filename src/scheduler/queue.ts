/**
 * 任务队列
 * 基于优先级的任务调度队列
 */

import { type Result, ok, err } from '../shared/result.js'
import { AppError } from '../shared/error.js'

export type Priority = 'low' | 'medium' | 'high'

export interface QueueItem<T> {
  id: string
  data: T
  priority: Priority
  createdAt: number
  attempts: number
}

const PRIORITY_WEIGHTS: Record<Priority, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

export interface Queue<T> {
  // 入队
  enqueue(id: string, data: T, priority?: Priority): void
  // 出队（获取最高优先级任务）
  dequeue(): QueueItem<T> | null
  // 查看队首但不移除
  peek(): QueueItem<T> | null
  // 通过 ID 获取
  get(id: string): QueueItem<T> | null
  // 移除指定任务
  remove(id: string): boolean
  // 更新优先级
  updatePriority(id: string, priority: Priority): Result<void, AppError>
  // 增加尝试次数
  incrementAttempts(id: string): void
  // 队列长度
  size(): number
  // 是否为空
  isEmpty(): boolean
  // 清空队列
  clear(): void
  // 获取所有任务
  all(): QueueItem<T>[]
  // 按条件过滤
  filter(predicate: (item: QueueItem<T>) => boolean): QueueItem<T>[]
}

export function createQueue<T>(): Queue<T> {
  const items = new Map<string, QueueItem<T>>()

  // 按优先级和时间排序获取下一个任务
  function getNextItem(): QueueItem<T> | null {
    if (items.size === 0) return null

    let best: QueueItem<T> | null = null
    for (const item of items.values()) {
      if (!best) {
        best = item
        continue
      }

      const currentWeight = PRIORITY_WEIGHTS[item.priority]
      const bestWeight = PRIORITY_WEIGHTS[best.priority]

      // 先按优先级，再按创建时间
      if (currentWeight > bestWeight || (currentWeight === bestWeight && item.createdAt < best.createdAt)) {
        best = item
      }
    }

    return best
  }

  return {
    enqueue(id: string, data: T, priority: Priority = 'medium'): void {
      items.set(id, {
        id,
        data,
        priority,
        createdAt: Date.now(),
        attempts: 0,
      })
    },

    dequeue(): QueueItem<T> | null {
      const item = getNextItem()
      if (item) {
        items.delete(item.id)
      }
      return item
    },

    peek(): QueueItem<T> | null {
      return getNextItem()
    },

    get(id: string): QueueItem<T> | null {
      return items.get(id) ?? null
    },

    remove(id: string): boolean {
      return items.delete(id)
    },

    updatePriority(id: string, priority: Priority): Result<void, AppError> {
      const item = items.get(id)
      if (!item) {
        return err(AppError.storeNotFound('QueueItem', id))
      }
      item.priority = priority
      return ok(undefined)
    },

    incrementAttempts(id: string): void {
      const item = items.get(id)
      if (item) {
        item.attempts++
      }
    },

    size(): number {
      return items.size
    },

    isEmpty(): boolean {
      return items.size === 0
    },

    clear(): void {
      items.clear()
    },

    all(): QueueItem<T>[] {
      return Array.from(items.values()).sort((a, b) => {
        const weightDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority]
        return weightDiff !== 0 ? weightDiff : a.createdAt - b.createdAt
      })
    },

    filter(predicate: (item: QueueItem<T>) => boolean): QueueItem<T>[] {
      return Array.from(items.values()).filter(predicate)
    },
  }
}

// 延迟队列（用于重试等场景）
export interface DelayedQueue<T> extends Queue<T> {
  enqueueDelayed(id: string, data: T, delayMs: number, priority?: Priority): void
  processDelayed(): void
}

export function createDelayedQueue<T>(): DelayedQueue<T> {
  const baseQueue = createQueue<T>()
  const delayed = new Map<string, { data: T; priority: Priority; executeAt: number }>()

  return {
    ...baseQueue,

    enqueueDelayed(id: string, data: T, delayMs: number, priority: Priority = 'medium'): void {
      delayed.set(id, {
        data,
        priority,
        executeAt: Date.now() + delayMs,
      })
    },

    processDelayed(): void {
      const now = Date.now()
      for (const [id, item] of delayed.entries()) {
        if (item.executeAt <= now) {
          baseQueue.enqueue(id, item.data, item.priority)
          delayed.delete(id)
        }
      }
    },
  }
}
