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

    // Relaxed threshold for CI/slow machines: single lock op < 5ms avg
    expect(avgTime).toBeLessThan(5)
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

    // Check operation should be fast (< 1ms even on slow machines)
    expect(avgTime).toBeLessThan(1)
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

    // Relaxed threshold: < 1ms per read
    expect(avgTime).toBeLessThan(1)
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

    const tasks = Array.from({ length: concurrency }, async (_, workerIdx) => {
      for (let i = 0; i < iterations; i++) {
        if (!isLocked()) {
          createLock(process.pid + workerIdx)
          successCount++
          await new Promise(resolve => setTimeout(resolve, 1))
          releaseLock()
        } else {
          await new Promise(resolve => setTimeout(resolve, 1))
        }
      }
    })

    await Promise.all(tasks)

    expect(successCount).toBeGreaterThan(0)
  })

  it('死锁检测与清理', () => {
    const deadPid = 99999
    createLock(deadPid)

    const pid = getLockPid()
    expect(pid).toBe(deadPid)

    const running = isProcessRunning(deadPid)
    expect(running).toBe(false)

    if (!running) {
      releaseLock()
    }

    expect(isLocked()).toBe(false)
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

    for (let i = 0; i < iterations; i++) {
      try {
        createLock(process.pid)
        if (!isLocked()) errors++
        releaseLock()
        if (isLocked()) errors++
      } catch {
        errors++
      }
    }

    expect(errors).toBe(0)
  })

  it('长时间持有锁的性能影响', async () => {
    createLock(process.pid)

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

    await holdPromise

    // Check operations should not be blocked by lock hold time
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
    expect(isLocked()).toBe(false)
    expect(getLockPid()).toBe(null)

    const pid = process.pid
    createLock(pid)
    expect(isLocked()).toBe(true)
    expect(getLockPid()).toBe(pid)

    releaseLock()
    expect(isLocked()).toBe(false)
    expect(getLockPid()).toBe(null)

    // Multiple releases should not throw
    releaseLock()
    releaseLock()
    expect(isLocked()).toBe(false)
  })

  it('锁文件损坏处理', () => {
    writeFileSync(TEST_LOCK_FILE, 'invalid-pid')

    const pid = getLockPid()
    expect(pid).toBe(null)

    releaseLock()
    expect(isLocked()).toBe(false)
  })

  it('锁被外部删除', () => {
    createLock(process.pid)
    expect(isLocked()).toBe(true)

    unlinkSync(TEST_LOCK_FILE)

    expect(isLocked()).toBe(false)
    expect(() => releaseLock()).not.toThrow()
  })
})
