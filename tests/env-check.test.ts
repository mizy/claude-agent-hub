/**
 * 测试环境验证
 * 快速检查测试环境是否正确配置
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'

describe('测试环境验证', () => {
  it('应能访问项目根目录', () => {
    const packageJsonPath = join(process.cwd(), 'package.json')
    expect(existsSync(packageJsonPath)).toBe(true)
  })

  it('应能访问构建产物', () => {
    const cliPath = join(process.cwd(), 'dist/cli/index.js')
    expect(existsSync(cliPath)).toBe(true)
  })

  it('应能导入测试辅助工具', async () => {
    const { TestDataDir, runConcurrent, PerfTimer } = await import('./helpers/concurrency.js')

    expect(typeof TestDataDir).toBe('function')
    expect(typeof runConcurrent).toBe('function')
    expect(typeof PerfTimer).toBe('function')
  })

  it('应能导入队列模块', async () => {
    const { createQueue } = await import('../src/scheduler/createQueue.js')
    expect(typeof createQueue).toBe('function')

    const queue = createQueue()
    expect(queue.size()).toBe(0)
  })

  it('应能创建和清理测试目录', async () => {
    const { TestDataDir } = await import('./helpers/concurrency.js')

    const testDir = new TestDataDir('env-check')
    const path = testDir.setup()

    expect(existsSync(path)).toBe(true)

    testDir.cleanup()
    expect(existsSync(path)).toBe(false)
  })

  it('应能运行并发函数', async () => {
    const { runConcurrent, analyzeConcurrencyResults } = await import('./helpers/concurrency.js')

    const durations: number[] = []
    const results = await runConcurrent(5, async (i) => {
      const start = Date.now()
      await new Promise(resolve => setTimeout(resolve, 10))
      durations.push(Date.now() - start)
      return i
    })

    expect(results.length).toBe(5)
    expect(results.every(r => r.status === 'fulfilled')).toBe(true)

    const stats = analyzeConcurrencyResults(results, durations)
    expect(stats.total).toBe(5)
    expect(stats.succeeded).toBe(5)
    expect(stats.successRate).toBe(1)
  })

  it('应能使用性能计时器', async () => {
    const { PerfTimer } = await import('./helpers/concurrency.js')

    const timer = new PerfTimer()
    timer.mark('step1')
    timer.mark('step2')

    const elapsed = timer.elapsed()
    expect(elapsed).toBeGreaterThanOrEqual(0)

    const stats = timer.getStats()
    expect(stats).toHaveProperty('step1')
    expect(stats).toHaveProperty('step2')
  })
})
