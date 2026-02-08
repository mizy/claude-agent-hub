/**
 * 事件总线
 * 简单的发布订阅模式，用于模块间解耦通信
 */

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>

interface EventBus {
  on<T>(event: string, handler: EventHandler<T>): () => void
  off(event: string, handler: EventHandler): void
  emit<T>(event: string, payload: T): Promise<void>
  once<T>(event: string, handler: EventHandler<T>): () => void
  clear(event?: string): void
}

// 预定义的事件类型
export type SchedulerEvents = {
  // 任务事件
  'task:created': { taskId: string }
  'task:started': { taskId: string }
  'task:completed': { taskId: string }
  'task:failed': { taskId: string; error: string }

  // 调度器事件
  'scheduler:started': { pid: number }
  'scheduler:stopped': Record<string, never>
  'scheduler:tick': { timestamp: string }
}

function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>()

  return {
    on<T>(event: string, handler: EventHandler<T>): () => void {
      let set = handlers.get(event)
      if (!set) {
        set = new Set()
        handlers.set(event, set)
      }
      set.add(handler as EventHandler)
      return () => this.off(event, handler as EventHandler)
    },

    off(event: string, handler: EventHandler): void {
      handlers.get(event)?.delete(handler)
    },

    async emit<T>(event: string, payload: T): Promise<void> {
      const eventHandlers = handlers.get(event)
      if (!eventHandlers) return

      const promises = Array.from(eventHandlers).map(handler => {
        try {
          return Promise.resolve(handler(payload))
        } catch (e) {
          console.error(`Event handler error for ${event}:`, e)
          return Promise.resolve()
        }
      })

      await Promise.all(promises)
    },

    once<T>(event: string, handler: EventHandler<T>): () => void {
      const wrapper: EventHandler<T> = async payload => {
        this.off(event, wrapper as EventHandler)
        await handler(payload)
      }
      return this.on(event, wrapper)
    },

    clear(event?: string): void {
      if (event) {
        handlers.delete(event)
      } else {
        handlers.clear()
      }
    },
  }
}

// 全局事件总线实例
export const eventBus = createEventBus()

// 类型安全的事件发射
export function emitEvent<K extends keyof SchedulerEvents>(
  event: K,
  payload: SchedulerEvents[K]
): Promise<void> {
  return eventBus.emit(event, payload)
}

// 类型安全的事件监听
export function onEvent<K extends keyof SchedulerEvents>(
  event: K,
  handler: EventHandler<SchedulerEvents[K]>
): () => void {
  return eventBus.on(event, handler)
}
