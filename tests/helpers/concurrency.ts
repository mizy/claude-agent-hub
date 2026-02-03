/**
 * 并发测试辅助工具
 * 提供多进程模拟、文件锁测试、性能统计等功能
 */

import { execaNode } from 'execa'
import { mkdirSync, rmSync, existsSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'

/**
 * 测试数据目录管理
 */
export class TestDataDir {
  private dir: string

  constructor(name: string) {
    this.dir = join('/tmp', `cah-test-${name}-${Date.now()}`)
  }

  setup(): string {
    if (existsSync(this.dir)) {
      rmSync(this.dir, { recursive: true, force: true })
    }
    mkdirSync(this.dir, { recursive: true })
    return this.dir
  }

  cleanup(): void {
    if (existsSync(this.dir)) {
      rmSync(this.dir, { recursive: true, force: true })
    }
  }

  getPath(): string {
    return this.dir
  }
}

/**
 * 多进程并发执行
 */
export async function runConcurrent(
  count: number,
  fn: (index: number) => Promise<unknown>
): Promise<PromiseSettledResult<unknown>[]> {
  const tasks = Array(count)
    .fill(null)
    .map((_, i) => fn(i))
  return Promise.allSettled(tasks)
}

/**
 * CLI 命令并发执行
 */
export async function runCLIConcurrent(
  count: number,
  args: string[],
  env?: Record<string, string>
): Promise<PromiseSettledResult<unknown>[]> {
  const cliPath = join(process.cwd(), 'dist/cli/index.js')
  return runConcurrent(count, () =>
    execaNode(cliPath, args, {
      env: { ...process.env, ...env },
    })
  )
}

/**
 * 创建过期的文件锁（用于测试死锁恢复）
 */
export function createStaleLock(lockPath: string, ageMs: number): void {
  writeFileSync(lockPath, String(process.pid))
  const pastTime = (Date.now() - ageMs) / 1000
  utimesSync(lockPath, pastTime, pastTime)
}

/**
 * 性能计时器
 */
export class PerfTimer {
  private start: number
  private marks: Map<string, number> = new Map()

  constructor() {
    this.start = Date.now()
  }

  mark(name: string): void {
    this.marks.set(name, Date.now())
  }

  elapsed(markName?: string): number {
    const startTime = markName ? this.marks.get(markName) ?? this.start : this.start
    return Date.now() - startTime
  }

  getStats(): Record<string, number> {
    const stats: Record<string, number> = {}
    for (const [name, time] of this.marks) {
      stats[name] = time - this.start
    }
    return stats
  }
}

/**
 * 统计并发测试结果
 */
export interface ConcurrencyStats {
  total: number
  succeeded: number
  failed: number
  successRate: number
  avgDuration: number
  p95Duration: number
}

export function analyzeConcurrencyResults(
  results: PromiseSettledResult<unknown>[],
  durations: number[]
): ConcurrencyStats {
  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed = results.length - succeeded
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
  const sortedDurations = [...durations].sort((a, b) => a - b)
  const p95Index = Math.floor(sortedDurations.length * 0.95)
  const p95Duration = sortedDurations[p95Index] ?? 0

  return {
    total: results.length,
    succeeded,
    failed,
    successRate: succeeded / results.length,
    avgDuration,
    p95Duration,
  }
}

/**
 * 等待条件满足（用于异步测试）
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: {
    timeout?: number
    interval?: number
    message?: string
  } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100, message = 'Condition not met' } = options
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return
    }
    await sleep(interval)
  }

  throw new Error(`${message} (timeout: ${timeout}ms)`)
}

/**
 * 延迟辅助函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
