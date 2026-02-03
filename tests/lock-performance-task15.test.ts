/**
 * 锁性能测试 - 任务15（轻量级快速验证）
 *
 * 测试范围（6 个核心场景）：
 * 1. 基本性能验证：单次锁操作延迟、锁检查、高频吞吐量
 * 2. 并发安全验证：并发写入竞争、并发获取任务
 * 3. 可靠性验证：死锁检测与恢复
 *
 * 特点：执行快速（< 30 秒），适合 CI/CD，与任务 19 基线对比
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, unlinkSync, mkdirSync, rmSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

// 测试用的临时目录
const TEST_DIR = join(tmpdir(), `cah-lock-test15-${Date.now()}`)
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

// 场景 1: 基本性能验证
describe('WorkflowQueue 锁基本性能验证', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T1: 单次锁操作延迟 (目标 < 1ms, 基线 0.102ms)', () => {
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

    console.log('\n[T1] 单次锁操作延迟')
    console.log(`迭代次数: ${iterations}`)
    console.log(`平均延迟: ${metrics.avg.toFixed(3)}ms`)
    console.log(`P50: ${metrics.p50.toFixed(3)}ms, P95: ${metrics.p95.toFixed(3)}ms, P99: ${metrics.p99.toFixed(3)}ms`)
    console.log(`最小: ${metrics.min.toFixed(3)}ms, 最大: ${metrics.max.toFixed(3)}ms`)

    // 基准对比（任务19: 0.102ms）
    const baselineAvg = 0.102
    const change = ((metrics.avg - baselineAvg) / baselineAvg) * 100
    console.log(`基准对比: ${change > 0 ? '+' : ''}${change.toFixed(1)}% (基准: ${baselineAvg}ms)`)

    expect(metrics.avg).toBeLessThan(1) // 目标值
    expect(metrics.p95).toBeLessThan(2) // 告警阈值
  })

  it('T2: 锁状态检查性能 (目标 < 0.1ms, 基线 0.001ms)', () => {
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

    console.log('\n[T2] 锁状态检查性能')
    console.log(`迭代次数: ${iterations}`)
    console.log(`平均延迟: ${metrics.avg.toFixed(4)}ms`)
    console.log(`P50: ${metrics.p50.toFixed(4)}ms, P95: ${metrics.p95.toFixed(4)}ms, P99: ${metrics.p99.toFixed(4)}ms`)

    // 基准对比（任务19: 0.001ms）
    const baselineAvg = 0.001
    const change = ((metrics.avg - baselineAvg) / baselineAvg) * 100
    console.log(`基准对比: ${change > 0 ? '+' : ''}${change.toFixed(1)}% (基准: ${baselineAvg}ms)`)

    expect(metrics.avg).toBeLessThan(0.1)
    expect(metrics.p95).toBeLessThan(0.5)
  })

  it('T3: 高频锁操作吞吐量 (目标 > 1K ops/s, 基线 10,075 ops/s)', () => {
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

    console.log('\n[T3] 高频锁操作吞吐量')
    console.log(`迭代次数: ${iterations}`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`吞吐量: ${throughput.toFixed(0)} ops/s`)
    console.log(`错误数: ${errors}`)

    // 基准对比（任务19: 10,075 ops/s）
    const baselineThroughput = 10075
    const change = ((throughput - baselineThroughput) / baselineThroughput) * 100
    console.log(`基准对比: ${change > 0 ? '+' : ''}${change.toFixed(1)}% (基准: ${baselineThroughput} ops/s)`)

    expect(errors).toBe(0)
    expect(throughput).toBeGreaterThan(1000) // 目标值
  })
})

// 场景 2: 并发安全验证
describe('WorkflowQueue 并发安全验证', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T4: 并发写入竞争 (10 workers × 100 ops)', async () => {
    const workerCount = 10
    const opsPerWorker = 100
    const totalOps = workerCount * opsPerWorker

    let successCount = 0
    const latencies: number[] = []
    const errors: string[] = []

    const start = performance.now()

    const workers = Array.from({ length: workerCount }, async (_, workerId) => {
      for (let i = 0; i < opsPerWorker; i++) {
        const opStart = performance.now()
        try {
          withLock(() => {
            // 模拟入队操作：写入数据
            const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
            data.jobs.push({
              id: `worker-${workerId}-job-${i}`,
              data: { taskId: 'test', nodeId: 'node1', instanceId: 'inst1', attempt: 1 },
              status: 'waiting',
            })
            require('fs').writeFileSync(QUEUE_FILE, JSON.stringify(data))
            successCount++
          })
          latencies.push(performance.now() - opStart)
        } catch (err) {
          errors.push((err as Error).message)
        }
      }
    })

    await Promise.all(workers)

    const elapsed = performance.now() - start
    const throughput = (successCount / elapsed) * 1000

    const metrics = calculateMetrics(latencies)

    console.log('\n[T4] 并发写入竞争')
    console.log(`Worker 数量: ${workerCount}, 每个 ${opsPerWorker} 次操作`)
    console.log(`成功操作: ${successCount}/${totalOps}`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`吞吐量: ${throughput.toFixed(0)} ops/s`)
    console.log(`平均延迟: ${metrics.avg.toFixed(3)}ms (P95: ${metrics.p95.toFixed(3)}ms)`)
    console.log(`错误数: ${errors.length}`)

    // 验证数据完整性
    const finalData = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
    const uniqueJobs = new Set(finalData.jobs.map((j: any) => j.id))

    console.log(`数据完整性: ${uniqueJobs.size}/${successCount} (${((uniqueJobs.size / successCount) * 100).toFixed(1)}%)`)

    expect(successCount).toBe(totalOps) // 100% 成功率
    expect(throughput).toBeGreaterThan(1000) // 至少 1K ops/s
    expect(uniqueJobs.size).toBe(successCount) // 100% 数据完整性
    expect(errors.length).toBe(0) // 零错误率
  })

  it('T5: 并发获取任务 (100 tasks, 10 workers)', async () => {
    // 准备 100 个待处理任务
    const taskCount = 100
    const jobs = Array.from({ length: taskCount }, (_, i) => ({
      id: `task-${i}`,
      data: { taskId: 'test', nodeId: 'node1', instanceId: 'inst1', attempt: 1 },
      status: 'waiting',
      priority: 0,
      createdAt: new Date().toISOString(),
      processAt: new Date().toISOString(),
    }))

    writeFileSync(QUEUE_FILE, JSON.stringify({ jobs, updatedAt: new Date().toISOString() }))

    const workerCount = 10
    const assignedTasks: string[][] = Array.from({ length: workerCount }, () => [])

    const start = performance.now()

    const workers = Array.from({ length: workerCount }, async (_, workerId) => {
      while (true) {
        try {
          const taskId = withLock(() => {
            const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
            const waitingJob = data.jobs.find((j: any) => j.status === 'waiting')
            if (!waitingJob) return null

            // 标记为处理中
            waitingJob.status = 'active'
            require('fs').writeFileSync(QUEUE_FILE, JSON.stringify(data))
            return waitingJob.id
          })

          if (!taskId) break

          assignedTasks[workerId]?.push(taskId)
          // 模拟处理时间
          await new Promise(resolve => setTimeout(resolve, 1))
        } catch {
          break
        }
      }
    })

    await Promise.all(workers)

    const elapsed = performance.now() - start
    const allAssignedTasks = assignedTasks.flat()
    const uniqueAssignedTasks = new Set(allAssignedTasks)

    console.log('\n[T5] 并发获取任务')
    console.log(`Worker 数量: ${workerCount}`)
    console.log(`初始任务数: ${taskCount}`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`分配任务数: ${allAssignedTasks.length}`)
    console.log(`唯一任务数: ${uniqueAssignedTasks.size}`)
    console.log(`重复分配: ${allAssignedTasks.length - uniqueAssignedTasks.size}`)
    console.log(`互斥正确性: ${((uniqueAssignedTasks.size / allAssignedTasks.length) * 100).toFixed(1)}%`)

    assignedTasks.forEach((tasks, i) => {
      console.log(`  Worker ${i}: ${tasks.length} 个任务`)
    })

    // 验证互斥性
    expect(allAssignedTasks.length).toBe(taskCount) // 所有任务被消费
    expect(uniqueAssignedTasks.size).toBe(taskCount) // 无重复分配
    expect(allAssignedTasks.length - uniqueAssignedTasks.size).toBe(0) // 100% 互斥正确性
  })
})

// 场景 3: 可靠性验证
describe('WorkflowQueue 可靠性验证', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T6: 死锁检测与恢复 (目标 < 10ms, 基线 0.3ms)', () => {
    const deadPid = 99999
    writeFileSync(LOCK_FILE, deadPid.toString())

    // 修改时间戳，模拟锁已过期（超过 30 秒）
    const oldTime = Date.now() - 31000
    require('fs').utimesSync(LOCK_FILE, new Date(oldTime), new Date(oldTime))

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
      require('fs').utimesSync(LOCK_FILE, new Date(oldTime), new Date(oldTime))
    }

    const metrics = calculateMetrics(latencies)

    console.log('\n[T6] 死锁检测与恢复')
    console.log(`迭代次数: ${iterations}`)
    console.log(`平均延迟: ${metrics.avg.toFixed(3)}ms`)
    console.log(`P50: ${metrics.p50.toFixed(3)}ms, P95: ${metrics.p95.toFixed(3)}ms, P99: ${metrics.p99.toFixed(3)}ms`)

    // 基准对比（任务19: 0.3ms）
    const baselineAvg = 0.3
    const change = ((metrics.avg - baselineAvg) / baselineAvg) * 100
    console.log(`基准对比: ${change > 0 ? '+' : ''}${change.toFixed(1)}% (基准: ${baselineAvg}ms)`)

    expect(metrics.avg).toBeLessThan(10) // 目标值
    expect(metrics.p95).toBeLessThan(50) // 告警阈值

    cleanupTestEnv()
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
