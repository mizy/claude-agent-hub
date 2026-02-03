/**
 * 锁性能测试 - 任务11
 *
 * 基础性能验证，包含 10 个核心测试场景：
 * 1. 基本性能（3个）：单次锁操作、锁检查、PID 读取
 * 2. 并发安全（2个）：并发竞争、死锁清理
 * 3. 压力测试（2个）：高频操作、长时间持有锁
 * 4. 可靠性（3个）：状态一致性、损坏处理、外部删除恢复
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, unlinkSync, mkdirSync, rmSync, writeFileSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

// 测试用的临时目录
const TEST_DIR = join(tmpdir(), `cah-lock-test11-${Date.now()}`)
const QUEUE_FILE = join(TEST_DIR, 'queue.json')
const LOCK_FILE = `${QUEUE_FILE}.lock`

// 性能数据收集
interface PerformanceMetrics {
  min: number
  max: number
  avg: number
  p50: number
  p95: number
  p99: number
}

function calculateMetrics(values: number[]): PerformanceMetrics {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)

  return {
    min: sorted[0] || 0,
    max: sorted[sorted.length - 1] || 0,
    avg: sum / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
  }
}

// 模拟 WorkflowQueue 的锁机制
let lockAcquired = false

function acquireLock(): boolean {
  if (lockAcquired) return true

  try {
    if (existsSync(LOCK_FILE)) {
      const stat = statSync(LOCK_FILE)
      const age = Date.now() - stat.mtimeMs
      if (age < 30000) {
        return false
      }
      unlinkSync(LOCK_FILE)
    }

    writeFileSync(LOCK_FILE, process.pid.toString(), { flag: 'wx' })
    lockAcquired = true
    return true
  } catch {
    return false
  }
}

function releaseLock(): void {
  if (!lockAcquired) return

  try {
    if (existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE)
    }
    lockAcquired = false
  } catch {
    // ignore
  }
}

function withLock<T>(fn: () => T): T {
  const maxRetries = 10
  const retryDelay = 100

  for (let i = 0; i < maxRetries; i++) {
    if (acquireLock()) {
      try {
        return fn()
      } finally {
        releaseLock()
      }
    }
    execSync(`sleep ${retryDelay / 1000}`)
  }

  throw new Error('Failed to acquire queue lock')
}

function isLocked(): boolean {
  return existsSync(LOCK_FILE)
}

function readLockPid(): string | null {
  try {
    if (!existsSync(LOCK_FILE)) return null
    return readFileSync(LOCK_FILE, 'utf-8').trim()
  } catch {
    return null
  }
}

// 测试辅助函数
function cleanupTestEnv(): void {
  lockAcquired = false
  if (existsSync(LOCK_FILE)) {
    try {
      unlinkSync(LOCK_FILE)
    } catch {
      // ignore
    }
  }
  if (existsSync(QUEUE_FILE)) {
    try {
      unlinkSync(QUEUE_FILE)
    } catch {
      // ignore
    }
  }
}

function setupTestEnv(): void {
  mkdirSync(TEST_DIR, { recursive: true })
  writeFileSync(QUEUE_FILE, JSON.stringify({ jobs: [], updatedAt: new Date().toISOString() }))
}

// T1-T3: 基本性能测试
describe('基本性能测试', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T1: 单次锁操作性能 (目标 < 1ms)', () => {
    const iterations = 1000
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      withLock(() => {
        // 空操作
      })
      latencies.push(performance.now() - start)
    }

    const metrics = calculateMetrics(latencies)

    console.log('\n[T1] 单次锁操作性能')
    console.log(`迭代次数: ${iterations}`)
    console.log(`平均延迟: ${metrics.avg.toFixed(3)}ms`)
    console.log(`P50: ${metrics.p50.toFixed(3)}ms, P95: ${metrics.p95.toFixed(3)}ms, P99: ${metrics.p99.toFixed(3)}ms`)

    // 基准对比（Task-19: 0.102ms）
    const baselineAvg = 0.102
    const change = ((metrics.avg - baselineAvg) / baselineAvg) * 100
    console.log(`基准对比: ${change > 0 ? '+' : ''}${change.toFixed(1)}% (基准: ${baselineAvg}ms)`)

    expect(metrics.avg).toBeLessThan(1)
    expect(metrics.p95).toBeLessThan(2)
  })

  it('T2: 锁检查性能 (目标 < 0.1ms)', () => {
    acquireLock()

    const iterations = 10000
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      isLocked()
      latencies.push(performance.now() - start)
    }

    releaseLock()

    const metrics = calculateMetrics(latencies)

    console.log('\n[T2] 锁检查性能')
    console.log(`迭代次数: ${iterations}`)
    console.log(`平均延迟: ${metrics.avg.toFixed(4)}ms`)
    console.log(`P50: ${metrics.p50.toFixed(4)}ms, P95: ${metrics.p95.toFixed(4)}ms, P99: ${metrics.p99.toFixed(4)}ms`)

    // 基准对比（Task-19: 0.001ms）
    const baselineAvg = 0.001
    const change = ((metrics.avg - baselineAvg) / baselineAvg) * 100
    console.log(`基准对比: ${change > 0 ? '+' : ''}${change.toFixed(1)}% (基准: ${baselineAvg}ms)`)

    expect(metrics.avg).toBeLessThan(0.1)
    expect(metrics.p95).toBeLessThan(0.5)
  })

  it('T3: PID 读取性能 (目标 < 0.2ms)', () => {
    acquireLock()

    const iterations = 5000
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      readLockPid()
      latencies.push(performance.now() - start)
    }

    releaseLock()

    const metrics = calculateMetrics(latencies)

    console.log('\n[T3] PID 读取性能')
    console.log(`迭代次数: ${iterations}`)
    console.log(`平均延迟: ${metrics.avg.toFixed(4)}ms`)
    console.log(`P50: ${metrics.p50.toFixed(4)}ms, P95: ${metrics.p95.toFixed(4)}ms, P99: ${metrics.p99.toFixed(4)}ms`)

    // 基准对比（Task-19: 0.013ms）
    const baselineAvg = 0.013
    const change = ((metrics.avg - baselineAvg) / baselineAvg) * 100
    console.log(`基准对比: ${change > 0 ? '+' : ''}${change.toFixed(1)}% (基准: ${baselineAvg}ms)`)

    expect(metrics.avg).toBeLessThan(0.2)
    expect(metrics.p95).toBeLessThan(1)
  })
})

// T4-T5: 并发安全测试
describe('并发安全测试', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T4: 并发写入竞争 (目标 100% 互斥)', async () => {
    const workerCount = 10
    const opsPerWorker = 100
    const totalOps = workerCount * opsPerWorker

    let successCount = 0
    const errors: string[] = []

    const start = performance.now()

    const workers = Array.from({ length: workerCount }, async (_, workerId) => {
      for (let i = 0; i < opsPerWorker; i++) {
        try {
          withLock(() => {
            const data = JSON.parse(readFileSync(QUEUE_FILE, 'utf-8'))
            data.jobs.push({
              id: `worker-${workerId}-job-${i}`,
              status: 'waiting',
            })
            writeFileSync(QUEUE_FILE, JSON.stringify(data))
            successCount++
          })
        } catch (err) {
          errors.push((err as Error).message)
        }
      }
    })

    await Promise.all(workers)

    const elapsed = performance.now() - start

    // 验证数据完整性
    const finalData = JSON.parse(readFileSync(QUEUE_FILE, 'utf-8'))
    const uniqueJobs = new Set(finalData.jobs.map((j: any) => j.id))

    console.log('\n[T4] 并发写入竞争')
    console.log(`Worker 数量: ${workerCount}, 每个 ${opsPerWorker} 次操作`)
    console.log(`成功操作: ${successCount}/${totalOps}`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`数据完整性: ${uniqueJobs.size}/${successCount} (${((uniqueJobs.size / successCount) * 100).toFixed(1)}%)`)
    console.log(`错误数: ${errors.length}`)

    expect(successCount).toBe(totalOps)
    expect(uniqueJobs.size).toBe(successCount)
    expect(errors.length).toBe(0)
  })

  it('T5: 死锁检测与清理 (目标 < 10ms)', () => {
    const deadPid = 99999
    writeFileSync(LOCK_FILE, deadPid.toString())

    // 模拟锁已过期（超过 30 秒）
    const oldTime = Date.now() - 31000
    const fs = require('fs')
    fs.utimesSync(LOCK_FILE, new Date(oldTime), new Date(oldTime))

    const iterations = 100
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      lockAcquired = false
      const start = performance.now()

      const success = acquireLock()
      latencies.push(performance.now() - start)

      if (success) {
        releaseLock()
      }

      // 重新创建过期锁
      writeFileSync(LOCK_FILE, deadPid.toString())
      fs.utimesSync(LOCK_FILE, new Date(oldTime), new Date(oldTime))
    }

    const metrics = calculateMetrics(latencies)

    console.log('\n[T5] 死锁检测与清理')
    console.log(`迭代次数: ${iterations}`)
    console.log(`平均延迟: ${metrics.avg.toFixed(3)}ms`)
    console.log(`P50: ${metrics.p50.toFixed(3)}ms, P95: ${metrics.p95.toFixed(3)}ms, P99: ${metrics.p99.toFixed(3)}ms`)

    // 基准对比（Task-19: 0.3ms）
    const baselineAvg = 0.3
    const change = ((metrics.avg - baselineAvg) / baselineAvg) * 100
    console.log(`基准对比: ${change > 0 ? '+' : ''}${change.toFixed(1)}% (基准: ${baselineAvg}ms)`)

    expect(metrics.avg).toBeLessThan(10)
    expect(metrics.p95).toBeLessThan(50)

    cleanupTestEnv()
  })
})

// T6-T7: 压力测试
describe('压力测试', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T6: 高频率锁操作 (目标 > 1,000 ops/s)', () => {
    const iterations = 10000
    let errors = 0

    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      try {
        withLock(() => {
          if (!isLocked()) errors++
        })
      } catch {
        errors++
      }
    }

    const elapsed = performance.now() - start
    const throughput = (iterations / elapsed) * 1000

    console.log('\n[T6] 高频率锁操作')
    console.log(`迭代次数: ${iterations}`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`吞吐量: ${throughput.toFixed(0)} ops/s`)
    console.log(`错误数: ${errors}`)

    // 基准对比（Task-19: 10,075 ops/s）
    const baselineThroughput = 10075
    const change = ((throughput - baselineThroughput) / baselineThroughput) * 100
    console.log(`基准对比: ${change > 0 ? '+' : ''}${change.toFixed(1)}% (基准: ${baselineThroughput} ops/s)`)

    expect(errors).toBe(0)
    expect(throughput).toBeGreaterThan(1000)
  })

  it('T7: 长时间持有锁影响 (验证其他操作不受阻)', async () => {
    acquireLock()

    const holdTime = 100
    const checkIterations = 1000

    const holdPromise = new Promise<void>(resolve => {
      setTimeout(() => {
        releaseLock()
        resolve()
      }, holdTime)
    })

    const start = performance.now()
    for (let i = 0; i < checkIterations; i++) {
      isLocked()
    }
    const checkTime = performance.now() - start
    const avgCheckTime = checkTime / checkIterations

    await holdPromise

    console.log('\n[T7] 长时间持有锁影响')
    console.log(`持有时间: ${holdTime}ms`)
    console.log(`检查次数: ${checkIterations}`)
    console.log(`检查总耗时: ${checkTime.toFixed(2)}ms`)
    console.log(`平均单次检查: ${avgCheckTime.toFixed(4)}ms`)

    expect(avgCheckTime).toBeLessThan(0.1)
    expect(checkTime).toBeLessThan(holdTime)
  })
})

// T8-T10: 可靠性测试
describe('可靠性测试', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T8: 锁状态一致性 (获取/释放/重复释放)', () => {
    console.log('\n[T8] 锁状态一致性')

    // 初始状态：无锁
    expect(isLocked()).toBe(false)
    console.log('初始状态: 无锁 ✓')

    // 获取锁
    const acquired = acquireLock()
    expect(acquired).toBe(true)
    expect(isLocked()).toBe(true)
    console.log('获取锁: 成功 ✓')

    // 释放锁
    releaseLock()
    expect(isLocked()).toBe(false)
    console.log('释放锁: 成功 ✓')

    // 重复释放锁（应该安全）
    releaseLock()
    expect(isLocked()).toBe(false)
    console.log('重复释放: 安全 ✓')

    // 再次获取
    const reacquired = acquireLock()
    expect(reacquired).toBe(true)
    expect(isLocked()).toBe(true)
    console.log('再次获取: 成功 ✓')

    releaseLock()
  })

  it('T9: 锁文件损坏处理 (写入无效内容)', () => {
    console.log('\n[T9] 锁文件损坏处理')

    // 写入无效内容
    writeFileSync(LOCK_FILE, 'invalid-content-not-a-pid')

    // 模拟锁已过期
    const oldTime = Date.now() - 31000
    const fs = require('fs')
    fs.utimesSync(LOCK_FILE, new Date(oldTime), new Date(oldTime))

    lockAcquired = false

    // 尝试获取锁（应该能自动恢复）
    const start = performance.now()
    const recovered = acquireLock()
    const elapsed = performance.now() - start

    console.log(`损坏锁恢复: ${recovered}`)
    console.log(`恢复耗时: ${elapsed.toFixed(2)}ms`)

    expect(recovered).toBe(true)
    expect(elapsed).toBeLessThan(100)

    releaseLock()
  })

  it('T10: 锁被外部删除 (自动恢复)', () => {
    console.log('\n[T10] 锁被外部删除')

    // 获取锁
    acquireLock()
    expect(isLocked()).toBe(true)
    console.log('初始状态: 锁已获取 ✓')

    // 外部删除锁文件
    unlinkSync(LOCK_FILE)
    expect(existsSync(LOCK_FILE)).toBe(false)
    console.log('外部删除: 锁文件已删除 ✓')

    // 释放锁（应该安全）
    releaseLock()
    lockAcquired = false
    console.log('释放操作: 安全 ✓')

    // 再次获取锁（应该能成功）
    const start = performance.now()
    const reacquired = acquireLock()
    const elapsed = performance.now() - start

    console.log(`重新获取: ${reacquired}`)
    console.log(`恢复耗时: ${elapsed.toFixed(2)}ms`)

    expect(reacquired).toBe(true)
    expect(elapsed).toBeLessThan(100)

    releaseLock()
  })
})

// 清理测试目录
afterEach(() => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true })
  } catch {
    // ignore
  }
})
