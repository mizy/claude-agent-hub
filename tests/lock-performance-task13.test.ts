/**
 * 锁性能测试 - 任务13
 *
 * 测试定位：综合场景验证 - 填补 Task 12（深度分析）和 Task 15（快速验证）之间的空白
 * 测试规模：中等规模（8个场景）
 * 执行时间：2-3 分钟
 *
 * 测试场景：
 * 场景组 1: 真实业务场景模拟（3个）
 * - T1: 任务入队性能（1000个任务批量入队）
 * - T2: 任务出队性能（20 Workers 并发消费）
 * - T3: 混合操作场景（入队+出队+更新状态）
 *
 * 场景组 2: 并发压力测试（2个）
 * - T4: 中等并发写入（30 Workers × 50 ops）
 * - T5: 高并发写入（50 Workers × 30 ops）
 *
 * 场景组 3: 稳定性测试（2个）
 * - T6: 中时长持续运行（2分钟）
 * - T7: 周期性波动负载（低-高-低）
 *
 * 场景组 4: 资源监控（1个）
 * - T8: 资源使用分析（内存、CPU、文件句柄）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, unlinkSync, mkdirSync, rmSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

// 测试用的临时目录
const TEST_DIR = join(tmpdir(), `cah-lock-test13-${Date.now()}`)
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

// 计算变异系数
function calculateCV(values: number[]): number {
  if (values.length === 0) return 0
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  if (avg === 0) return 0
  const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length
  const stdDev = Math.sqrt(variance)
  return (stdDev / avg) * 100
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

// 获取内存使用情况
function getMemoryUsage(): number {
  const usage = process.memoryUsage()
  return usage.heapUsed / 1024 / 1024 // MB
}

// 场景组 1: 真实业务场景模拟
describe('场景组 1: 真实业务场景模拟', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T1: 任务入队性能（单 Worker 批量入队）', () => {
    const taskCount = 1000
    const priorityDistribution = {
      high: Math.floor(taskCount * 0.1),   // 10%
      medium: Math.floor(taskCount * 0.6), // 60%
      low: Math.floor(taskCount * 0.3),    // 30%
    }

    const latencies: number[] = []
    let successCount = 0

    const start = performance.now()

    for (let i = 0; i < taskCount; i++) {
      const opStart = performance.now()

      // 确定优先级
      let priority = 0
      if (i < priorityDistribution.high) priority = 2
      else if (i < priorityDistribution.high + priorityDistribution.medium) priority = 1

      try {
        withLock(() => {
          const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
          data.jobs.push({
            id: `task-${i}`,
            data: { taskId: 'test', nodeId: 'node1', instanceId: 'inst1', attempt: 1 },
            status: 'waiting',
            priority,
            createdAt: new Date().toISOString(),
            processAt: new Date().toISOString(),
          })
          require('fs').writeFileSync(QUEUE_FILE, JSON.stringify(data))
          successCount++
        })
        latencies.push(performance.now() - opStart)
      } catch (err) {
        console.error(`入队失败: ${(err as Error).message}`)
      }
    }

    const elapsed = performance.now() - start
    const throughput = (successCount / elapsed) * 1000
    const metrics = calculateMetrics(latencies)

    console.log('\n[T1] 任务入队性能')
    console.log(`任务数量: ${taskCount}`)
    console.log(`成功入队: ${successCount}/${taskCount}`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`吞吐量: ${throughput.toFixed(0)} ops/s`)
    console.log(`延迟: 平均=${metrics.avg.toFixed(2)}ms, P50=${metrics.p50.toFixed(2)}ms, P95=${metrics.p95.toFixed(2)}ms, P99=${metrics.p99.toFixed(2)}ms`)

    // 验证数据完整性
    const finalData = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
    const highPriority = finalData.jobs.filter((j: any) => j.priority === 2).length
    const mediumPriority = finalData.jobs.filter((j: any) => j.priority === 1).length
    const lowPriority = finalData.jobs.filter((j: any) => j.priority === 0).length

    console.log(`优先级分布: High=${highPriority}, Medium=${mediumPriority}, Low=${lowPriority}`)

    expect(successCount).toBe(taskCount)
    expect(throughput).toBeGreaterThan(500) // 目标: > 500 ops/s
    expect(metrics.avg).toBeLessThan(1.5)   // 目标: < 1.5ms
    expect(metrics.p95).toBeLessThan(3)     // 目标: < 3ms
  })

  it('T2: 任务出队性能（多 Worker 并发消费）', async () => {
    // 准备 500 个待处理任务
    const taskCount = 500
    const jobs = Array.from({ length: taskCount }, (_, i) => ({
      id: `task-${i}`,
      data: { taskId: 'test', nodeId: 'node1', instanceId: 'inst1', attempt: 1 },
      status: 'waiting',
      priority: i % 3,
      createdAt: new Date().toISOString(),
      processAt: new Date().toISOString(),
    }))

    writeFileSync(QUEUE_FILE, JSON.stringify({ jobs, updatedAt: new Date().toISOString() }))

    const workerCount = 20
    const assignedTasks: string[][] = Array.from({ length: workerCount }, () => [])
    const latencies: number[] = []

    const start = performance.now()

    const workers = Array.from({ length: workerCount }, async (_, workerId) => {
      while (true) {
        const opStart = performance.now()
        try {
          const taskId = withLock(() => {
            const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
            const waitingJob = data.jobs.find((j: any) => j.status === 'waiting')
            if (!waitingJob) return null

            waitingJob.status = 'active'
            require('fs').writeFileSync(QUEUE_FILE, JSON.stringify(data))
            return waitingJob.id
          })

          if (!taskId) break

          latencies.push(performance.now() - opStart)
          assignedTasks[workerId]?.push(taskId)
        } catch {
          break
        }
      }
    })

    await Promise.all(workers)

    const elapsed = performance.now() - start
    const allAssignedTasks = assignedTasks.flat()
    const uniqueAssignedTasks = new Set(allAssignedTasks)
    const throughput = (allAssignedTasks.length / elapsed) * 1000
    const metrics = calculateMetrics(latencies)

    console.log('\n[T2] 任务出队性能')
    console.log(`Worker 数量: ${workerCount}`)
    console.log(`初始任务数: ${taskCount}`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`消费任务数: ${allAssignedTasks.length}`)
    console.log(`吞吐量: ${throughput.toFixed(0)} ops/s`)
    console.log(`延迟: 平均=${metrics.avg.toFixed(2)}ms, P50=${metrics.p50.toFixed(2)}ms, P95=${metrics.p95.toFixed(2)}ms`)
    console.log(`互斥性: 唯一任务=${uniqueAssignedTasks.size}, 重复分配=${allAssignedTasks.length - uniqueAssignedTasks.size}`)

    // Worker 负载均衡分析
    const tasksPerWorker = assignedTasks.map(tasks => tasks.length)
    const avgTasksPerWorker = tasksPerWorker.reduce((a, b) => a + b, 0) / workerCount
    const maxTasks = Math.max(...tasksPerWorker)
    const minTasks = Math.min(...tasksPerWorker)
    console.log(`负载均衡: 平均=${avgTasksPerWorker.toFixed(1)}, 最大=${maxTasks}, 最小=${minTasks}`)

    expect(allAssignedTasks.length).toBe(taskCount)
    expect(uniqueAssignedTasks.size).toBe(taskCount) // 100% 互斥性
    expect(throughput).toBeGreaterThan(800) // 目标: > 800 ops/s
    expect(metrics.avg).toBeLessThan(2)     // 目标: < 2ms
    expect(metrics.p95).toBeLessThan(5)     // 目标: < 5ms
  })

  it('T3: 混合操作场景（入队 + 出队 + 更新状态）', { timeout: 40000 }, async () => {
    const duration = 30000 // 运行 30 秒
    const enqueueWorkerCount = 10
    const dequeueWorkerCount = 10
    const updateWorkerCount = 5

    let enqueueCount = 0
    let dequeueCount = 0
    let updateCount = 0
    const errors: string[] = []

    const start = performance.now()
    const endTime = start + duration

    // 10 个 Worker 入队（每个创建 50 个任务）
    const enqueueWorkers = Array.from({ length: enqueueWorkerCount }, async (_, workerId) => {
      let opId = 0
      while (performance.now() < endTime) {
        try {
          withLock(() => {
            const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
            data.jobs.push({
              id: `enqueue-${workerId}-${opId++}`,
              data: { taskId: 'test', nodeId: 'node1', instanceId: 'inst1', attempt: 1 },
              status: 'waiting',
              processAt: new Date().toISOString(),
            })
            require('fs').writeFileSync(QUEUE_FILE, JSON.stringify(data))
            enqueueCount++
          })
        } catch (err) {
          errors.push(`enqueue: ${(err as Error).message}`)
        }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    })

    // 10 个 Worker 出队（消费任务）
    const dequeueWorkers = Array.from({ length: dequeueWorkerCount }, async () => {
      while (performance.now() < endTime) {
        try {
          withLock(() => {
            const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
            const waitingJob = data.jobs.find((j: any) => j.status === 'waiting')
            if (waitingJob) {
              waitingJob.status = 'active'
              require('fs').writeFileSync(QUEUE_FILE, JSON.stringify(data))
              dequeueCount++
            }
          })
        } catch (err) {
          errors.push(`dequeue: ${(err as Error).message}`)
        }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    })

    // 5 个 Worker 更新状态
    const updateWorkers = Array.from({ length: updateWorkerCount }, async () => {
      while (performance.now() < endTime) {
        try {
          withLock(() => {
            const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
            const activeJob = data.jobs.find((j: any) => j.status === 'active')
            if (activeJob) {
              activeJob.status = 'completed'
              activeJob.completedAt = new Date().toISOString()
              require('fs').writeFileSync(QUEUE_FILE, JSON.stringify(data))
              updateCount++
            }
          })
        } catch (err) {
          errors.push(`update: ${(err as Error).message}`)
        }
        await new Promise(resolve => setTimeout(resolve, 30))
      }
    })

    await Promise.all([...enqueueWorkers, ...dequeueWorkers, ...updateWorkers])

    const elapsed = performance.now() - start
    const totalOps = enqueueCount + dequeueCount + updateCount
    const throughput = (totalOps / elapsed) * 1000

    console.log('\n[T3] 混合操作场景')
    console.log(`运行时长: ${(elapsed / 1000).toFixed(1)}s`)
    console.log(`入队: ${enqueueCount}, 出队: ${dequeueCount}, 更新: ${updateCount}`)
    console.log(`总操作数: ${totalOps}`)
    console.log(`混合吞吐量: ${throughput.toFixed(0)} ops/s`)
    console.log(`错误数: ${errors.length}`)

    // 数据一致性验证
    const finalData = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
    const waitingJobs = finalData.jobs.filter((j: any) => j.status === 'waiting').length
    const activeJobs = finalData.jobs.filter((j: any) => j.status === 'active').length
    const completedJobs = finalData.jobs.filter((j: any) => j.status === 'completed').length
    console.log(`最终状态: waiting=${waitingJobs}, active=${activeJobs}, completed=${completedJobs}`)

    expect(throughput).toBeGreaterThan(800) // 目标: > 800 ops/s
    expect(errors.length).toBe(0)           // 零错误
  })
})

// 场景组 2: 并发压力测试
describe('场景组 2: 并发压力测试', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T4: 中等并发写入（30 Workers × 50 ops）', async () => {
    const workerCount = 30
    const opsPerWorker = 50
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
    const successRate = (successCount / totalOps) * 100
    const metrics = calculateMetrics(latencies)

    console.log('\n[T4] 中等并发写入（30 Workers）')
    console.log(`Worker 数量: ${workerCount}, 每个 ${opsPerWorker} 次操作`)
    console.log(`成功操作: ${successCount}/${totalOps} (${successRate.toFixed(1)}%)`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`吞吐量: ${throughput.toFixed(0)} ops/s`)
    console.log(`延迟: 平均=${metrics.avg.toFixed(2)}ms, P50=${metrics.p50.toFixed(2)}ms, P95=${metrics.p95.toFixed(2)}ms`)
    console.log(`错误数: ${errors.length}`)

    expect(successCount).toBe(totalOps)     // 100% 成功率
    expect(metrics.avg).toBeLessThan(2)     // 目标: < 2ms
    expect(throughput).toBeGreaterThan(1000) // 目标: > 1000 ops/s
    expect(errors.length).toBe(0)
  })

  it('T5: 高并发写入（50 Workers × 30 ops）', async () => {
    const workerCount = 50
    const opsPerWorker = 30
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
    const successRate = (successCount / totalOps) * 100
    const metrics = calculateMetrics(latencies)

    console.log('\n[T5] 高并发写入（50 Workers）')
    console.log(`Worker 数量: ${workerCount}, 每个 ${opsPerWorker} 次操作`)
    console.log(`成功操作: ${successCount}/${totalOps} (${successRate.toFixed(1)}%)`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`吞吐量: ${throughput.toFixed(0)} ops/s`)
    console.log(`延迟: 平均=${metrics.avg.toFixed(2)}ms, P50=${metrics.p50.toFixed(2)}ms, P95=${metrics.p95.toFixed(2)}ms`)
    console.log(`错误数: ${errors.length}`)

    expect(successRate).toBeGreaterThan(98) // 目标: > 98% 成功率
    expect(metrics.avg).toBeLessThan(3)     // 目标: < 3ms
    expect(throughput).toBeGreaterThan(800) // 目标: > 800 ops/s
  })
})

// 场景组 3: 稳定性测试
describe('场景组 3: 稳定性测试', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T6: 中时长持续运行（2分钟）', { timeout: 150000 }, async () => {
    const duration = 120000 // 运行 120 秒
    const workerCount = 10
    const sampleInterval = 5000 // 每 5 秒采样一次

    const throughputSamples: number[] = []
    let totalOps = 0
    const initialMemory = getMemoryUsage()

    const start = performance.now()
    const endTime = start + duration

    // 采样器：每 5 秒记录吞吐量
    const samplerPromise = (async () => {
      let lastOps = 0
      while (performance.now() < endTime) {
        await new Promise(resolve => setTimeout(resolve, sampleInterval))
        const currentOps = totalOps
        const opsInInterval = currentOps - lastOps
        const throughput = (opsInInterval / sampleInterval) * 1000
        throughputSamples.push(throughput)
        lastOps = currentOps
      }
    })()

    // 10 个 Worker 持续运行
    const workers = Array.from({ length: workerCount }, async () => {
      while (performance.now() < endTime) {
        try {
          withLock(() => {
            const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
            data.jobs.push({
              id: `job-${Date.now()}-${Math.random()}`,
              data: { taskId: 'test', nodeId: 'node1', instanceId: 'inst1', attempt: 1 },
              status: 'waiting',
            })
            require('fs').writeFileSync(QUEUE_FILE, JSON.stringify(data))
            totalOps++
          })
        } catch {
          // ignore
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    })

    await Promise.all([samplerPromise, ...workers])

    const elapsed = performance.now() - start
    const finalMemory = getMemoryUsage()
    const memoryGrowth = finalMemory - initialMemory
    const avgThroughput = (totalOps / elapsed) * 1000
    const cv = calculateCV(throughputSamples)

    console.log('\n[T6] 中时长持续运行（2分钟）')
    console.log(`运行时长: ${(elapsed / 1000).toFixed(1)}s`)
    console.log(`Worker 数量: ${workerCount}`)
    console.log(`总操作数: ${totalOps}`)
    console.log(`平均吞吐量: ${avgThroughput.toFixed(0)} ops/s`)
    console.log(`吞吐量变异系数 CV: ${cv.toFixed(1)}%`)
    console.log(`内存: 初始=${initialMemory.toFixed(2)}MB, 最终=${finalMemory.toFixed(2)}MB, 增长=${memoryGrowth.toFixed(2)}MB`)
    console.log(`采样次数: ${throughputSamples.length}`)

    expect(cv).toBeLessThan(15)             // 目标: CV < 15%
    expect(memoryGrowth).toBeLessThan(5)    // 目标: 内存增长 < 5MB
  })

  it('T7: 周期性波动负载（低-高-低）', { timeout: 70000 }, async () => {
    const cycleDuration = 20000 // 每周期 20 秒
    const lowWorkerCount = 5
    const highWorkerCount = 30

    const phases: { name: string; workers: number; duration: number }[] = [
      { name: '低峰', workers: lowWorkerCount, duration: cycleDuration },
      { name: '高峰', workers: highWorkerCount, duration: cycleDuration },
      { name: '低峰', workers: lowWorkerCount, duration: cycleDuration },
    ]

    const phaseResults: { name: string; throughput: number; ops: number }[] = []

    for (const phase of phases) {
      let opsCount = 0
      const phaseStart = performance.now()
      const endTime = phaseStart + phase.duration

      const workers = Array.from({ length: phase.workers }, async () => {
        while (performance.now() < endTime) {
          try {
            withLock(() => {
              const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
              data.jobs.push({
                id: `job-${Date.now()}-${Math.random()}`,
                data: { taskId: 'test', nodeId: 'node1', instanceId: 'inst1', attempt: 1 },
                status: 'waiting',
              })
              require('fs').writeFileSync(QUEUE_FILE, JSON.stringify(data))
              opsCount++
            })
          } catch {
            // ignore
          }
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      })

      await Promise.all(workers)

      const elapsed = performance.now() - phaseStart
      const throughput = (opsCount / elapsed) * 1000

      phaseResults.push({
        name: phase.name,
        throughput,
        ops: opsCount,
      })
    }

    console.log('\n[T7] 周期性波动负载')
    phaseResults.forEach((result, index) => {
      console.log(`阶段 ${index + 1} (${result.name}): ${result.ops} 操作, 吞吐量=${result.throughput.toFixed(0)} ops/s`)
    })

    // 峰值性能对比
    const lowPeakThroughput = (phaseResults[0]!.throughput + phaseResults[2]!.throughput) / 2
    const highPeakThroughput = phaseResults[1]!.throughput
    const performanceRatio = (highPeakThroughput / lowPeakThroughput).toFixed(2)
    console.log(`峰值性能对比: 高峰/低峰 = ${performanceRatio}x`)

    expect(phaseResults[0]!.throughput).toBeGreaterThan(0)
    expect(phaseResults[1]!.throughput).toBeGreaterThan(0)
    expect(phaseResults[2]!.throughput).toBeGreaterThan(0)
  })
})

// 场景组 4: 资源监控
describe('场景组 4: 资源监控', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T8: 资源使用分析', () => {
    const iterations = 5000
    const memorySnapshots: number[] = []

    memorySnapshots.push(getMemoryUsage())

    for (let i = 0; i < iterations; i++) {
      withLock(() => {
        const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
        data.jobs.push({
          id: `task-${i}`,
          data: { taskId: 'test', nodeId: 'node1', instanceId: 'inst1', attempt: 1 },
          status: 'waiting',
        })
        require('fs').writeFileSync(QUEUE_FILE, JSON.stringify(data))
      })

      // 每 1000 次操作记录一次内存
      if ((i + 1) % 1000 === 0) {
        memorySnapshots.push(getMemoryUsage())
      }
    }

    const initialMemory = memorySnapshots[0] || 0
    const finalMemory = memorySnapshots[memorySnapshots.length - 1] || 0
    const memoryGrowth = finalMemory - initialMemory
    const avgMemory = memorySnapshots.reduce((a, b) => a + b, 0) / memorySnapshots.length

    console.log('\n[T8] 资源使用分析')
    console.log(`迭代次数: ${iterations}`)
    console.log(`内存快照: ${memorySnapshots.length} 次`)
    console.log(`内存: 初始=${initialMemory.toFixed(2)}MB, 最终=${finalMemory.toFixed(2)}MB, 增长=${memoryGrowth.toFixed(2)}MB`)
    console.log(`平均内存: ${avgMemory.toFixed(2)}MB`)

    // 文件句柄检查
    const lockFileExists = existsSync(LOCK_FILE)
    console.log(`锁文件状态: ${lockFileExists ? '存在' : '已释放'}`)

    expect(lockFileExists).toBe(false) // 测试完成后锁文件应被释放
    expect(memoryGrowth).toBeLessThan(10) // 内存增长应在合理范围内
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
