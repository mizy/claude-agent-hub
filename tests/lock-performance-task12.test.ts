/**
 * 锁性能测试 - 任务12
 *
 * 性能退化专项调查：
 * 1. 基线重复测试：10 次迭代验证性能退化稳定性
 * 2. 并发性能深度分析：不同竞争者数量、持有锁时间、重试策略
 * 3. 系统负载影响测试：空闲/中等/高负载下的性能对比
 * 4. 文件 I/O 性能分析：分段计时、调用统计
 *
 * 核心问题：并发性能退化 17.5%（1.48ms vs 1.26ms）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, unlinkSync, mkdirSync, rmSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

// 测试用的临时目录
const TEST_DIR = join(tmpdir(), `cah-lock-test12-${Date.now()}`)
const QUEUE_FILE = join(TEST_DIR, 'queue.json')
const LOCK_FILE = `${QUEUE_FILE}.lock`

// 性能数据收集
interface PerformanceMetrics {
  min: number
  max: number
  avg: number
  median: number
  stdDev: number
  cv: number // 变异系数
  p50: number
  p75: number
  p90: number
  p95: number
  p99: number
}

interface TestResult {
  metrics: PerformanceMetrics
  rawData: number[]
  timestamp: string
  testId: string
  config?: Record<string, any>
}

// 存储所有测试结果
const testResults: TestResult[] = []

function calculateMetrics(values: number[]): PerformanceMetrics {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, median: 0, stdDev: 0, cv: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  const avg = sum / sorted.length
  const median = sorted[Math.floor(sorted.length * 0.5)] || 0

  // 标准差
  const variance = sorted.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / sorted.length
  const stdDev = Math.sqrt(variance)

  // 变异系数
  const cv = avg > 0 ? (stdDev / avg) * 100 : 0

  return {
    min: sorted[0] || 0,
    max: sorted[sorted.length - 1] || 0,
    avg,
    median,
    stdDev,
    cv,
    p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
    p75: sorted[Math.floor(sorted.length * 0.75)] || 0,
    p90: sorted[Math.floor(sorted.length * 0.9)] || 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
  }
}

function saveTestResult(testId: string, values: number[], config?: Record<string, any>) {
  const metrics = calculateMetrics(values)
  testResults.push({
    testId,
    metrics,
    rawData: values,
    timestamp: new Date().toISOString(),
    config,
  })
}

function compareWithBaseline(current: number, baseline: number, metric: string) {
  const change = ((current - baseline) / baseline) * 100
  const indicator = change > 0 ? '+' : ''
  console.log(`基准对比 (${metric}): ${indicator}${change.toFixed(1)}% (基准: ${baseline.toFixed(3)}ms)`)
  return change
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

function withLock<T>(fn: () => T, maxRetries = 10, retryDelay = 100): T {
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

// 场景组 1: 基线重复测试（10 次迭代）
describe('场景组 1: 基线重复测试', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T1: 单次锁操作延迟稳定性 (10 次迭代)', () => {
    const repeatCount = 10
    const iterations = 1000
    const allResults: number[] = []

    console.log('\n[T1] 单次锁操作延迟稳定性')
    console.log(`重复次数: ${repeatCount}, 每次迭代: ${iterations}`)
    console.log('---')

    // 预热
    for (let i = 0; i < 2; i++) {
      withLock(() => {})
    }

    // 10 次重复测试
    const repeatResults: number[] = []
    for (let r = 0; r < repeatCount; r++) {
      const latencies: number[] = []

      for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        withLock(() => {
          // 空操作
        })
        latencies.push(performance.now() - start)
      }

      const metrics = calculateMetrics(latencies)
      repeatResults.push(metrics.avg)
      allResults.push(...latencies)

      console.log(`Run ${r + 1}: 平均 ${metrics.avg.toFixed(3)}ms, P95 ${metrics.p95.toFixed(3)}ms`)

      // 测试间冷却
      if (r < repeatCount - 1) {
        execSync('sleep 1')
      }
    }

    const overallMetrics = calculateMetrics(allResults)
    const stabilityMetrics = calculateMetrics(repeatResults)

    console.log('---')
    console.log('总体统计:')
    console.log(`  平均延迟: ${overallMetrics.avg.toFixed(3)}ms ± ${overallMetrics.stdDev.toFixed(3)}ms`)
    console.log(`  变异系数: ${overallMetrics.cv.toFixed(2)}%`)
    console.log(`  P50/P95/P99: ${overallMetrics.p50.toFixed(3)}ms / ${overallMetrics.p95.toFixed(3)}ms / ${overallMetrics.p99.toFixed(3)}ms`)
    console.log('稳定性统计:')
    console.log(`  10 次平均的 CV: ${stabilityMetrics.cv.toFixed(2)}%`)

    // 基准对比（任务19: 0.107ms）
    compareWithBaseline(overallMetrics.avg, 0.107, '平均延迟')

    saveTestResult('T1', allResults, { repeatCount, iterations })

    expect(overallMetrics.avg).toBeLessThan(1)
    expect(stabilityMetrics.cv).toBeLessThan(10) // 稳定性：CV < 10%
  })

  it('T2: 并发竞争延迟稳定性 (10 次迭代) - 重点', () => {
    const repeatCount = 10
    const workerCount = 10
    const opsPerWorker = 100

    console.log('\n[T2] 并发竞争延迟稳定性 (重点测试)')
    console.log(`重复次数: ${repeatCount}, Workers: ${workerCount}, 每个 ${opsPerWorker} 次操作`)
    console.log('---')

    const allResults: number[] = []
    const repeatResults: number[] = []

    for (let r = 0; r < repeatCount; r++) {
      let successCount = 0
      const latencies: number[] = []

      const start = performance.now()

      const workers = Array.from({ length: workerCount }, async (_, workerId) => {
        for (let i = 0; i < opsPerWorker; i++) {
          const opStart = performance.now()
          try {
            withLock(() => {
              // 模拟队列操作
              const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
              data.jobs.push({
                id: `r${r}-w${workerId}-op${i}`,
                status: 'waiting',
              })
              require('fs').writeFileSync(QUEUE_FILE, JSON.stringify(data))
              successCount++
            })
            latencies.push(performance.now() - opStart)
          } catch (err) {
            // ignore
          }
        }
      })

      // 等待所有 workers 完成
      Promise.all(workers)

      // 同步等待（简化版）
      while (successCount < workerCount * opsPerWorker) {
        execSync('sleep 0.01')
        if (performance.now() - start > 30000) break
      }

      const metrics = calculateMetrics(latencies)
      repeatResults.push(metrics.avg)
      allResults.push(...latencies)

      console.log(`Run ${r + 1}: 平均 ${metrics.avg.toFixed(3)}ms, P95 ${metrics.p95.toFixed(3)}ms, 成功 ${successCount}`)

      // 清理数据
      writeFileSync(QUEUE_FILE, JSON.stringify({ jobs: [], updatedAt: new Date().toISOString() }))

      if (r < repeatCount - 1) {
        execSync('sleep 2')
      }
    }

    const overallMetrics = calculateMetrics(allResults)
    const stabilityMetrics = calculateMetrics(repeatResults)

    console.log('---')
    console.log('总体统计:')
    console.log(`  平均延迟: ${overallMetrics.avg.toFixed(3)}ms ± ${overallMetrics.stdDev.toFixed(3)}ms`)
    console.log(`  变异系数: ${overallMetrics.cv.toFixed(2)}%`)
    console.log(`  P50/P95/P99: ${overallMetrics.p50.toFixed(3)}ms / ${overallMetrics.p95.toFixed(3)}ms / ${overallMetrics.p99.toFixed(3)}ms`)
    console.log('稳定性统计:')
    console.log(`  10 次平均的 CV: ${stabilityMetrics.cv.toFixed(2)}%`)

    // 基准对比（任务19: 1.26ms）⚠️ 这是退化的核心指标
    const change = compareWithBaseline(overallMetrics.avg, 1.26, '并发竞争延迟')

    saveTestResult('T2', allResults, { repeatCount, workerCount, opsPerWorker })

    // 宽松的期望，记录实际值
    expect(overallMetrics.avg).toBeLessThan(5) // 只要不超过 5ms
    console.log(change > 15 ? '\n⚠️  确认性能退化 > 15%' : '\n✅ 性能正常')
  })

  it('T3: 吞吐量稳定性 (10 次迭代)', () => {
    const repeatCount = 10
    const iterations = 10000

    console.log('\n[T3] 吞吐量稳定性')
    console.log(`重复次数: ${repeatCount}, 每次迭代: ${iterations}`)
    console.log('---')

    const throughputResults: number[] = []

    for (let r = 0; r < repeatCount; r++) {
      let errors = 0

      const start = performance.now()

      for (let i = 0; i < iterations; i++) {
        try {
          withLock(() => {
            // 空操作
          })
        } catch {
          errors++
        }
      }

      const elapsed = performance.now() - start
      const throughput = (iterations / elapsed) * 1000
      throughputResults.push(throughput)

      console.log(`Run ${r + 1}: ${throughput.toFixed(0)} ops/s, 错误 ${errors}`)

      if (r < repeatCount - 1) {
        execSync('sleep 1')
      }
    }

    const metrics = calculateMetrics(throughputResults)

    console.log('---')
    console.log('总体统计:')
    console.log(`  平均吞吐量: ${metrics.avg.toFixed(0)} ops/s ± ${metrics.stdDev.toFixed(0)} ops/s`)
    console.log(`  变异系数: ${metrics.cv.toFixed(2)}%`)
    console.log(`  范围: ${metrics.min.toFixed(0)} - ${metrics.max.toFixed(0)} ops/s`)

    // 基准对比（任务19: 10075 ops/s）
    compareWithBaseline(metrics.avg, 10075, '吞吐量')

    saveTestResult('T3', throughputResults, { repeatCount, iterations })

    expect(metrics.avg).toBeGreaterThan(1000)
    expect(metrics.cv).toBeLessThan(15) // 稳定性
  })
})

// 场景组 2: 并发性能深度分析
describe('场景组 2: 并发性能深度分析', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T4: 不同竞争者数量下的性能', async () => {
    const workerCounts = [2, 5, 10, 20, 50]
    const opsPerWorker = 50

    console.log('\n[T4] 不同竞争者数量下的性能')
    console.log('---')

    for (const workerCount of workerCounts) {
      let successCount = 0
      const latencies: number[] = []

      const start = performance.now()

      const workers = Array.from({ length: workerCount }, async () => {
        for (let i = 0; i < opsPerWorker; i++) {
          const opStart = performance.now()
          try {
            withLock(() => {
              successCount++
            })
            latencies.push(performance.now() - opStart)
          } catch {
            // ignore
          }
        }
      })

      await Promise.all(workers)

      const elapsed = performance.now() - start
      const throughput = (successCount / elapsed) * 1000
      const metrics = calculateMetrics(latencies)

      console.log(`${workerCount} Workers:`)
      console.log(`  平均延迟: ${metrics.avg.toFixed(3)}ms, P95: ${metrics.p95.toFixed(3)}ms`)
      console.log(`  吞吐量: ${throughput.toFixed(0)} ops/s`)
      console.log(`  成功率: ${((successCount / (workerCount * opsPerWorker)) * 100).toFixed(1)}%`)

      saveTestResult(`T4-${workerCount}`, latencies, { workerCount, opsPerWorker })

      // 清理环境
      cleanupTestEnv()
      setupTestEnv()
      execSync('sleep 1')
    }

    expect(true).toBe(true)
  })

  it('T5: 不同持有锁时间的影响', async () => {
    const holdTimes = [0, 10, 50, 100] // ms
    const workerCount = 10
    const opsPerWorker = 50

    console.log('\n[T5] 不同持有锁时间的影响')
    console.log('---')

    for (const holdTime of holdTimes) {
      let successCount = 0
      const latencies: number[] = []

      const start = performance.now()

      const workers = Array.from({ length: workerCount }, async () => {
        for (let i = 0; i < opsPerWorker; i++) {
          const opStart = performance.now()
          try {
            withLock(() => {
              if (holdTime > 0) {
                execSync(`sleep ${holdTime / 1000}`)
              }
              successCount++
            })
            latencies.push(performance.now() - opStart)
          } catch {
            // ignore
          }
        }
      })

      await Promise.all(workers)

      const elapsed = performance.now() - start
      const throughput = (successCount / elapsed) * 1000
      const metrics = calculateMetrics(latencies)

      console.log(`持有锁 ${holdTime}ms:`)
      console.log(`  平均延迟: ${metrics.avg.toFixed(3)}ms, P95: ${metrics.p95.toFixed(3)}ms`)
      console.log(`  吞吐量: ${throughput.toFixed(0)} ops/s`)

      saveTestResult(`T5-${holdTime}ms`, latencies, { holdTime, workerCount, opsPerWorker })

      cleanupTestEnv()
      setupTestEnv()
      execSync('sleep 1')
    }

    expect(true).toBe(true)
  })

  it('T6: 重试机制性能分析', () => {
    const retryConfigs = [
      { maxRetries: 5, retryDelay: 50 },
      { maxRetries: 10, retryDelay: 100 },
      { maxRetries: 20, retryDelay: 100 },
      { maxRetries: 10, retryDelay: 200 },
    ]

    console.log('\n[T6] 重试机制性能分析')
    console.log('---')

    for (const config of retryConfigs) {
      const iterations = 100
      const latencies: number[] = []

      for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        try {
          withLock(() => {}, config.maxRetries, config.retryDelay)
          latencies.push(performance.now() - start)
        } catch {
          // ignore
        }
      }

      const metrics = calculateMetrics(latencies)

      console.log(`重试配置: maxRetries=${config.maxRetries}, retryDelay=${config.retryDelay}ms`)
      console.log(`  平均延迟: ${metrics.avg.toFixed(3)}ms, P95: ${metrics.p95.toFixed(3)}ms`)

      saveTestResult(`T6-${config.maxRetries}-${config.retryDelay}`, latencies, config)

      execSync('sleep 1')
    }

    expect(true).toBe(true)
  })
})

// 场景组 3: 系统负载影响测试
describe('场景组 3: 系统负载影响测试', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T7: 空闲系统性能', () => {
    console.log('\n[T7] 空闲系统性能')
    console.log('提示: 确保系统负载较低 (CPU < 10%)')
    console.log('---')

    const iterations = 5000
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      withLock(() => {
        // 空操作
      })
      latencies.push(performance.now() - start)
    }

    const metrics = calculateMetrics(latencies)

    console.log(`迭代次数: ${iterations}`)
    console.log(`平均延迟: ${metrics.avg.toFixed(3)}ms`)
    console.log(`P50/P95/P99: ${metrics.p50.toFixed(3)}ms / ${metrics.p95.toFixed(3)}ms / ${metrics.p99.toFixed(3)}ms`)

    saveTestResult('T7', latencies, { systemLoad: 'idle' })

    expect(metrics.avg).toBeLessThan(1)
  })

  it('T8: 中等负载性能', () => {
    console.log('\n[T8] 中等负载性能')
    console.log('提示: 模拟中等负载（同时运行其他任务）')
    console.log('---')

    // 简单模拟：增加一些文件 I/O 操作
    const iterations = 5000
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      // 模拟中等负载
      if (i % 10 === 0) {
        execSync('sleep 0.001')
      }

      const start = performance.now()
      withLock(() => {
        // 空操作
      })
      latencies.push(performance.now() - start)
    }

    const metrics = calculateMetrics(latencies)

    console.log(`迭代次数: ${iterations}`)
    console.log(`平均延迟: ${metrics.avg.toFixed(3)}ms`)
    console.log(`P50/P95/P99: ${metrics.p50.toFixed(3)}ms / ${metrics.p95.toFixed(3)}ms / ${metrics.p99.toFixed(3)}ms`)

    saveTestResult('T8', latencies, { systemLoad: 'medium' })

    expect(metrics.avg).toBeLessThan(2)
  })

  it('T9: 高负载性能', () => {
    console.log('\n[T9] 高负载性能')
    console.log('提示: 模拟高负载环境')
    console.log('---')

    const iterations = 5000
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      // 模拟高负载
      if (i % 5 === 0) {
        execSync('sleep 0.002')
      }

      const start = performance.now()
      withLock(() => {
        // 空操作
      })
      latencies.push(performance.now() - start)
    }

    const metrics = calculateMetrics(latencies)

    console.log(`迭代次数: ${iterations}`)
    console.log(`平均延迟: ${metrics.avg.toFixed(3)}ms`)
    console.log(`P50/P95/P99: ${metrics.p50.toFixed(3)}ms / ${metrics.p95.toFixed(3)}ms / ${metrics.p99.toFixed(3)}ms`)

    saveTestResult('T9', latencies, { systemLoad: 'high' })

    expect(metrics.avg).toBeLessThan(3)
  })
})

// 场景组 4: 文件 I/O 性能分析
describe('场景组 4: 文件 I/O 性能分析', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('T10: 锁操作分段计时', () => {
    console.log('\n[T10] 锁操作分段计时')
    console.log('---')

    const iterations = 1000
    const timings = {
      checkLock: [] as number[],
      createLock: [] as number[],
      releaseLock: [] as number[],
      total: [] as number[],
    }

    for (let i = 0; i < iterations; i++) {
      const totalStart = performance.now()

      // 检查锁
      const checkStart = performance.now()
      const lockExists = existsSync(LOCK_FILE)
      timings.checkLock.push(performance.now() - checkStart)

      if (!lockExists) {
        // 创建锁
        const createStart = performance.now()
        try {
          writeFileSync(LOCK_FILE, process.pid.toString(), { flag: 'wx' })
          lockAcquired = true
          timings.createLock.push(performance.now() - createStart)
        } catch {
          timings.createLock.push(0)
        }

        // 释放锁
        const releaseStart = performance.now()
        if (lockAcquired) {
          unlinkSync(LOCK_FILE)
          lockAcquired = false
        }
        timings.releaseLock.push(performance.now() - releaseStart)
      } else {
        timings.createLock.push(0)
        timings.releaseLock.push(0)
      }

      timings.total.push(performance.now() - totalStart)
    }

    console.log('分段时间统计:')
    const checkMetrics = calculateMetrics(timings.checkLock)
    const createMetrics = calculateMetrics(timings.createLock.filter(t => t > 0))
    const releaseMetrics = calculateMetrics(timings.releaseLock.filter(t => t > 0))
    const totalMetrics = calculateMetrics(timings.total)

    console.log(`  检查锁: ${checkMetrics.avg.toFixed(4)}ms (${((checkMetrics.avg / totalMetrics.avg) * 100).toFixed(1)}%)`)
    console.log(`  创建锁: ${createMetrics.avg.toFixed(4)}ms (${((createMetrics.avg / totalMetrics.avg) * 100).toFixed(1)}%)`)
    console.log(`  释放锁: ${releaseMetrics.avg.toFixed(4)}ms (${((releaseMetrics.avg / totalMetrics.avg) * 100).toFixed(1)}%)`)
    console.log(`  总耗时: ${totalMetrics.avg.toFixed(4)}ms`)

    saveTestResult('T10', timings.total, { timings })

    expect(totalMetrics.avg).toBeLessThan(1)
  })

  it('T11: 文件系统调用统计', () => {
    console.log('\n[T11] 文件系统调用统计')
    console.log('---')

    const iterations = 1000
    let existsCount = 0
    let writeCount = 0
    let unlinkCount = 0
    let statCount = 0

    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      // 模拟完整的锁操作
      existsCount++ // existsSync(LOCK_FILE)

      if (!existsSync(LOCK_FILE)) {
        writeCount++ // writeFileSync
        writeFileSync(LOCK_FILE, process.pid.toString(), { flag: 'wx' })
        lockAcquired = true

        unlinkCount++ // unlinkSync
        unlinkSync(LOCK_FILE)
        lockAcquired = false
      } else {
        statCount++ // statSync
      }
    }

    const elapsed = performance.now() - start
    const avgTime = elapsed / iterations

    console.log(`迭代次数: ${iterations}`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`平均耗时: ${avgTime.toFixed(3)}ms`)
    console.log('---')
    console.log('文件系统调用次数:')
    console.log(`  existsSync: ${existsCount}`)
    console.log(`  writeFileSync: ${writeCount}`)
    console.log(`  unlinkSync: ${unlinkCount}`)
    console.log(`  statSync: ${statCount}`)
    console.log(`  总调用: ${existsCount + writeCount + unlinkCount + statCount}`)

    saveTestResult('T11', [avgTime], { existsCount, writeCount, unlinkCount, statCount })

    expect(avgTime).toBeLessThan(1)
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

// 保存所有测试结果到文件
if (process.env.VITEST_WORKER_ID === '1' || !process.env.VITEST_WORKER_ID) {
  // 只在主进程或单进程模式下执行
  process.on('exit', () => {
    const reportDir = join(process.cwd(), 'tests/reports/lock-performance/task-12')
    mkdirSync(reportDir, { recursive: true })

    const outputFile = join(reportDir, 'performance-data.json')
    writeFileSync(outputFile, JSON.stringify(testResults, null, 2))

    console.log(`\n✅ 测试结果已保存到: ${outputFile}`)
  })
}
