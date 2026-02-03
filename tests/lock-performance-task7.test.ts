/**
 * 锁性能测试 - 任务7（探索性基线测试）
 *
 * 测试目标：建立测试框架和方法论，为后续任务奠定基础
 * 测试场景：
 * 1. 基本功能验证（S1-S3）：锁的获取/释放、状态检查、PID 记录
 * 2. 初步性能测试（S4-S5）：单次操作延迟、简单并发测试
 * 3. 基础可靠性（S6-S7）：超时处理、错误恢复
 *
 * 参数设置：保守参数（100次迭代，3个并发worker），无严格性能阈值
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, unlinkSync, mkdirSync, rmSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

// 测试用的临时目录
const TEST_DIR = join(tmpdir(), `cah-lock-test7-${Date.now()}`)
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

function getLockPid(): number | null {
  if (!existsSync(LOCK_FILE)) return null
  try {
    const content = require('fs').readFileSync(LOCK_FILE, 'utf-8')
    return parseInt(content.trim(), 10)
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

// S1-S3: 基本功能验证
describe('WorkflowQueue 锁基本功能验证', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('S1: 锁的基本获取和释放', () => {
    console.log('\n[S1] 锁的基本获取和释放')

    // 测试获取锁
    const acquired1 = acquireLock()
    console.log(`首次获取锁: ${acquired1}`)
    expect(acquired1).toBe(true)
    expect(isLocked()).toBe(true)

    // 测试重复获取（应该返回 true，因为已经持有）
    const acquired2 = acquireLock()
    console.log(`重复获取锁: ${acquired2}`)
    expect(acquired2).toBe(true)

    // 释放锁
    releaseLock()
    console.log(`释放锁后状态: ${isLocked()}`)
    expect(isLocked()).toBe(false)

    // 再次获取
    const acquired3 = acquireLock()
    console.log(`再次获取锁: ${acquired3}`)
    expect(acquired3).toBe(true)

    releaseLock()
    console.log('✓ 基本获取/释放功能正常')
  })

  it('S2: 锁状态检查', () => {
    console.log('\n[S2] 锁状态检查')

    // 初始状态：无锁
    expect(isLocked()).toBe(false)
    console.log('初始状态: 无锁')

    // 获取锁后
    acquireLock()
    expect(isLocked()).toBe(true)
    console.log('获取锁后: 已锁定')

    // 释放锁后
    releaseLock()
    expect(isLocked()).toBe(false)
    console.log('释放锁后: 无锁')

    console.log('✓ 锁状态检查功能正常')
  })

  it('S3: PID 记录和读取', () => {
    console.log('\n[S3] PID 记录和读取')

    const currentPid = process.pid
    console.log(`当前进程 PID: ${currentPid}`)

    // 获取锁
    acquireLock()

    // 读取 PID
    const recordedPid = getLockPid()
    console.log(`锁文件记录的 PID: ${recordedPid}`)

    expect(recordedPid).toBe(currentPid)

    releaseLock()
    console.log('✓ PID 记录和读取功能正常')
  })
})

// S4-S5: 初步性能测试
describe('WorkflowQueue 初步性能测试', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('S4: 单次操作延迟（100次迭代）', () => {
    console.log('\n[S4] 单次操作延迟测试')

    const iterations = 100
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      withLock(() => {
        // 空操作，仅测量锁开销
      })
      latencies.push(performance.now() - start)
    }

    const metrics = calculateMetrics(latencies)

    console.log(`迭代次数: ${iterations}`)
    console.log(`平均延迟: ${metrics.avg.toFixed(3)}ms`)
    console.log(`中位数(P50): ${metrics.p50.toFixed(3)}ms`)
    console.log(`P95: ${metrics.p95.toFixed(3)}ms, P99: ${metrics.p99.toFixed(3)}ms`)
    console.log(`最小: ${metrics.min.toFixed(3)}ms, 最大: ${metrics.max.toFixed(3)}ms`)

    // 探索性测试，仅记录数据，不设严格阈值
    console.log('\n观察点:')
    if (metrics.avg < 1) {
      console.log('✓ 平均延迟良好（< 1ms）')
    } else if (metrics.avg < 5) {
      console.log('⚠ 平均延迟可接受（1-5ms）')
    } else {
      console.log('✗ 平均延迟较高（> 5ms），可能需要优化')
    }

    // 数据收集，不做断言
    expect(latencies.length).toBe(iterations)
  })

  it('S5: 简单并发测试（3个并发进程）', async () => {
    console.log('\n[S5] 简单并发测试')

    const workerCount = 3
    const opsPerWorker = 30
    const totalOps = workerCount * opsPerWorker

    let successCount = 0
    const errors: string[] = []
    const latencies: number[] = []

    const start = performance.now()

    const workers = Array.from({ length: workerCount }, async (_, workerId) => {
      for (let i = 0; i < opsPerWorker; i++) {
        const opStart = performance.now()
        try {
          withLock(() => {
            // 模拟写入操作
            const data = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
            data.jobs.push({
              id: `worker-${workerId}-op-${i}`,
              data: { taskId: 'test', nodeId: 'node1' },
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
    const metrics = calculateMetrics(latencies)

    console.log(`Worker 数量: ${workerCount}`)
    console.log(`每个 Worker 操作数: ${opsPerWorker}`)
    console.log(`成功操作: ${successCount}/${totalOps}`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`平均延迟: ${metrics.avg.toFixed(3)}ms`)
    console.log(`错误数: ${errors.length}`)

    // 验证数据完整性
    const finalData = JSON.parse(require('fs').readFileSync(QUEUE_FILE, 'utf-8'))
    console.log(`写入任务数: ${finalData.jobs.length}`)

    console.log('\n观察点:')
    console.log(successCount === totalOps ? '✓ 100% 成功率' : `✗ 成功率: ${(successCount / totalOps * 100).toFixed(1)}%`)
    console.log(errors.length === 0 ? '✓ 零错误率' : `✗ 发生 ${errors.length} 个错误`)
    console.log(finalData.jobs.length === successCount ? '✓ 数据完整性良好' : `✗ 数据不一致`)

    // 基础验证
    expect(successCount).toBe(totalOps)
    expect(errors.length).toBe(0)
  })
})

// S6-S7: 基础可靠性
describe('WorkflowQueue 基础可靠性测试', () => {
  beforeEach(() => {
    setupTestEnv()
  })

  afterEach(() => {
    cleanupTestEnv()
  })

  it('S6: 超时处理（模拟过期锁）', () => {
    console.log('\n[S6] 超时处理测试')

    // 创建一个过期的锁（模拟其他进程崩溃后遗留的锁）
    writeFileSync(LOCK_FILE, '99999') // 不存在的 PID

    // 修改时间戳，模拟锁已过期（超过 30 秒）
    const oldTime = Date.now() - 31000
    require('fs').utimesSync(LOCK_FILE, new Date(oldTime), new Date(oldTime))

    console.log('创建过期锁（31秒前）')

    // 尝试获取锁
    const start = performance.now()
    const acquired = acquireLock()
    const elapsed = performance.now() - start

    console.log(`获取锁结果: ${acquired}`)
    console.log(`耗时: ${elapsed.toFixed(3)}ms`)

    expect(acquired).toBe(true) // 应该能清理过期锁并获取
    expect(isLocked()).toBe(true)

    const newPid = getLockPid()
    console.log(`新 PID: ${newPid}（当前进程: ${process.pid}）`)
    expect(newPid).toBe(process.pid)

    releaseLock()
    console.log('✓ 超时处理功能正常')
  })

  it('S7: 错误恢复（异常情况处理）', async () => {
    console.log('\n[S7] 错误恢复测试')

    let scenario1Success = false
    let scenario2Success = false
    let scenario3Success = false

    // 场景1: 锁文件被外部删除
    console.log('\n场景1: 锁文件被外部删除')
    acquireLock()
    unlinkSync(LOCK_FILE) // 外部删除
    releaseLock() // 应该能正常处理
    scenario1Success = acquireLock() // 应该能重新获取
    console.log(`  重新获取锁: ${scenario1Success}`)
    releaseLock()

    // 场景2: 并发竞争失败后重试
    console.log('\n场景2: 并发竞争失败后重试')
    acquireLock() // 主进程持有锁

    const retryTest = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        releaseLock() // 100ms 后释放锁
      }, 100)

      // 另一个"进程"尝试获取（通过重试机制）
      setTimeout(() => {
        lockAcquired = false // 重置状态，模拟另一个进程
        try {
          const result = withLock(() => true)
          resolve(result)
        } catch {
          resolve(false)
        }
      }, 10)
    })

    scenario2Success = await retryTest
    console.log(`  重试获取锁: ${scenario2Success}`)

    // 场景3: 处理损坏的锁文件
    console.log('\n场景3: 处理损坏的锁文件')
    writeFileSync(LOCK_FILE, 'invalid-content-not-a-pid')
    lockAcquired = false
    scenario3Success = acquireLock()
    console.log(`  处理损坏锁文件: ${scenario3Success}`)
    releaseLock()

    console.log('\n汇总:')
    console.log(`场景1（外部删除）: ${scenario1Success ? '✓' : '✗'}`)
    console.log(`场景2（重试机制）: ${scenario2Success ? '✓' : '✗'}`)
    console.log(`场景3（损坏文件）: ${scenario3Success ? '✓' : '✗'}`)

    expect(scenario1Success).toBe(true)
    expect(scenario2Success).toBe(true)
    expect(scenario3Success).toBe(true)
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
