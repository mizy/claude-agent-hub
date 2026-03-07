/**
 * CLI 后端并发限流
 *
 * 共享的调用槽位管理，防止同时调用过多 CLI 进程
 */

/** 最大并发调用数 */
const MAX_CONCURRENT_CALLS = 5

/** 当前活跃调用数 */
let activeCalls = 0

/** 等待队列 */
const waitQueue: Array<() => void> = []

/** 获取调用许可 */
export async function acquireSlot(signal?: AbortSignal): Promise<void> {
  if (activeCalls < MAX_CONCURRENT_CALLS) {
    activeCalls++
    return
  }
  if (signal?.aborted) {
    throw new DOMException('Slot acquisition aborted', 'AbortError')
  }
  return new Promise<void>((resolve, reject) => {
    let onAbort: (() => void) | undefined
    const waiter = () => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      activeCalls++
      resolve()
    }
    waitQueue.push(waiter)

    if (signal) {
      onAbort = () => {
        const idx = waitQueue.indexOf(waiter)
        if (idx !== -1) {
          waitQueue.splice(idx, 1)
          reject(new DOMException('Slot acquisition aborted', 'AbortError'))
        }
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/** 释放调用许可 */
export function releaseSlot(): void {
  activeCalls--
  const next = waitQueue.shift()
  if (next) next()
}

/** 获取槽位信息 */
export function getSlotInfo(): { active: number; max: number } {
  return { active: activeCalls, max: MAX_CONCURRENT_CALLS }
}
