/**
 * 锁性能测试
 *
 * 测试 runner.lock 文件的性能特征：
 * 1. 锁获取/释放的延迟
 * 2. 并发竞争下的行为
 * 3. 大量操作下的性能表现
 * 4. 死锁清理机制的效率
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// 测试环境配置
const TEST_DATA_DIR = join(tmpdir(), `cah-lock-test-${Date.now()}`)
const TEST_LOCK_FILE = join(TEST_DATA_DIR, 'runner.lock')

// 模拟锁操作
function createLock(pid: number): void {
  mkdirSync(TEST_DATA_DIR, { recursive: true })
  writeFileSync(TEST_LOCK_FILE, String(pid))
}

function releaseLock(): void {
  try {
    if (existsSync(TEST_LOCK_FILE)) {
      unlinkSync(TEST_LOCK_FILE)
    }
  } catch {
    // ignore
  }
}

function isLocked(): boolean {
  return existsSync(TEST_LOCK_FILE)
}

function getLockPid(): number | null {
  if (!isLocked()) return null
  try {
    const content = readFileSync(TEST_LOCK_FILE, 'utf-8').trim()
    const pid = parseInt(content, 10)
    return isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('锁基本性能', () => {
  beforeEach(() => {
    mkdirSync(TEST_DATA_DIR, { recursive: true })
  })

  afterEach(() => {
    releaseLock()
    try {
      unlinkSync(TEST_DATA_DIR)
    } catch {
      // ignore
    }
  })

  it('单次锁操作性能', () => {
    const iterations = 1000
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      createLock(process.pid)
      releaseLock()
    }

    const elapsed = performance.now() - start
    const avgTime = elapsed / iterations

    console.log(`\n锁操作性能: ${iterations} 次迭代`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`平均单次: ${avgTime.toFixed(3)}ms`)

    // 单次操作应该在 1ms 以内
    expect(avgTime).toBeLessThan(1)
  })

  it('锁检查性能', () => {
    createLock(process.pid)

    const iterations = 10000
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      isLocked()
    }

    const elapsed = performance.now() - start
    const avgTime = elapsed / iterations

    console.log(`\n锁检查性能: ${iterations} 次迭代`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`平均单次: ${avgTime.toFixed(3)}ms`)

    // 检查操作应该非常快
    expect(avgTime).toBeLessThan(0.1)
  })

  it('PID 读取性能', () => {
    createLock(process.pid)

    const iterations = 5000
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      getLockPid()
    }

    const elapsed = performance.now() - start
    const avgTime = elapsed / iterations

    console.log(`\nPID 读取性能: ${iterations} 次迭代`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`平均单次: ${avgTime.toFixed(3)}ms`)

    expect(avgTime).toBeLessThan(0.2)
  })
})

describe('锁并发行为', () => {
  beforeEach(() => {
    mkdirSync(TEST_DATA_DIR, { recursive: true })
  })

  afterEach(() => {
    releaseLock()
  })

  it('并发写入竞争', async () => {
    const concurrency = 10
    const iterations = 100
    let successCount = 0

    const start = performance.now()

    const tasks = Array.from({ length: concurrency }, async (_, workerIdx) => {
      for (let i = 0; i < iterations; i++) {
        // 尝试获取锁
        if (!isLocked()) {
          createLock(process.pid + workerIdx)
          successCount++

          // 模拟持有锁一段时间
          await new Promise(resolve => setTimeout(resolve, 1))

          releaseLock()
        } else {
          // 等待重试
          await new Promise(resolve => setTimeout(resolve, 1))
        }
      }
    })

    await Promise.all(tasks)

    const elapsed = performance.now() - start

    console.log(`\n并发竞争测试: ${concurrency} 个 worker, 每个 ${iterations} 次尝试`)
    console.log(`成功获取锁: ${successCount} 次`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)

    // 应该有一定的成功率
    expect(successCount).toBeGreaterThan(0)
  })

  it('死锁检测与清理', () => {
    // 创建一个已死进程的锁
    const deadPid = 99999
    createLock(deadPid)

    const start = performance.now()

    // 检测死锁
    const pid = getLockPid()
    expect(pid).toBe(deadPid)

    const running = isProcessRunning(deadPid)
    expect(running).toBe(false)

    // 清理死锁
    if (!running) {
      releaseLock()
    }

    const elapsed = performance.now() - start

    console.log(`\n死锁检测与清理耗时: ${elapsed.toFixed(2)}ms`)

    // 清理后应该没有锁
    expect(isLocked()).toBe(false)

    // 整个过程应该很快
    expect(elapsed).toBeLessThan(10)
  })
})

describe('锁压力测试', () => {
  beforeEach(() => {
    mkdirSync(TEST_DATA_DIR, { recursive: true })
  })

  afterEach(() => {
    releaseLock()
  })

  it('高频率锁操作', () => {
    const iterations = 10000
    let errors = 0

    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      try {
        createLock(process.pid)
        if (!isLocked()) {
          errors++
        }
        releaseLock()
        if (isLocked()) {
          errors++
        }
      } catch {
        errors++
      }
    }

    const elapsed = performance.now() - start
    const opsPerSecond = (iterations / elapsed) * 1000

    console.log(`\n高频率锁操作: ${iterations} 次迭代`)
    console.log(`总耗时: ${elapsed.toFixed(2)}ms`)
    console.log(`吞吐量: ${opsPerSecond.toFixed(0)} ops/s`)
    console.log(`错误数: ${errors}`)

    expect(errors).toBe(0)
    // 至少每秒 1000 次操作
    expect(opsPerSecond).toBeGreaterThan(1000)
  })

  it('长时间持有锁的性能影响', async () => {
    createLock(process.pid)

    const holdTime = 100 // 持有 100ms
    const checkIterations = 1000

    // 在后台持有锁
    const holdPromise = new Promise<void>(resolve => {
      setTimeout(() => {
        releaseLock()
        resolve()
      }, holdTime)
    })

    // 同时进行大量检查
    const start = performance.now()
    for (let i = 0; i < checkIterations; i++) {
      isLocked()
    }
    const checkTime = performance.now() - start

    await holdPromise

    console.log(`\n长时间持有锁测试`)
    console.log(`持有时间: ${holdTime}ms`)
    console.log(`${checkIterations} 次检查耗时: ${checkTime.toFixed(2)}ms`)
    console.log(`平均单次检查: ${(checkTime / checkIterations).toFixed(3)}ms`)

    // 检查操作不应该被锁持有时间影响
    expect(checkTime).toBeLessThan(holdTime)
  })
})

describe('锁可靠性测试', () => {
  beforeEach(() => {
    mkdirSync(TEST_DATA_DIR, { recursive: true })
  })

  afterEach(() => {
    releaseLock()
  })

  it('锁状态一致性', () => {
    // 初始无锁
    expect(isLocked()).toBe(false)
    expect(getLockPid()).toBe(null)

    // 创建锁
    const pid = process.pid
    createLock(pid)
    expect(isLocked()).toBe(true)
    expect(getLockPid()).toBe(pid)

    // 释放锁
    releaseLock()
    expect(isLocked()).toBe(false)
    expect(getLockPid()).toBe(null)

    // 多次释放不应该出错
    releaseLock()
    releaseLock()
    expect(isLocked()).toBe(false)
  })

  it('锁文件损坏处理', () => {
    // 写入无效内容
    writeFileSync(TEST_LOCK_FILE, 'invalid-pid')

    const pid = getLockPid()
    expect(pid).toBe(null)

    // 应该能正常清理
    releaseLock()
    expect(isLocked()).toBe(false)
  })

  it('锁被外部删除', () => {
    createLock(process.pid)
    expect(isLocked()).toBe(true)

    // 外部直接删除锁文件
    unlinkSync(TEST_LOCK_FILE)

    // 检查应该返回 false
    expect(isLocked()).toBe(false)

    // 释放操作不应该出错
    expect(() => releaseLock()).not.toThrow()
  })
})
