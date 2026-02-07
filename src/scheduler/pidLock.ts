/**
 * PID 文件锁 - 防止多个守护进程同时运行
 */

import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { DATA_DIR } from '../store/paths.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('pid-lock')

const PID_FILE = join(DATA_DIR, 'daemon.pid')

export interface PidLockInfo {
  pid: number
  startedAt: string
  cwd: string
  command: string
}

/**
 * 检查进程是否在运行
 */
function isProcessRunning(pid: number): boolean {
  try {
    // 发送信号 0 不会杀死进程，只是检查进程是否存在
    process.kill(pid, 0)
    return true
  } catch (error) {
    return false
  }
}

/**
 * 获取 PID 锁信息
 */
export function getPidLock(): PidLockInfo | null {
  if (!existsSync(PID_FILE)) {
    return null
  }

  try {
    const content = readFileSync(PID_FILE, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    logger.warn(`Failed to read PID file: ${error}`)
    return null
  }
}

/**
 * 尝试获取锁
 * @returns true 如果成功获取锁，false 如果已有其他进程持有锁
 */
export function acquirePidLock(): { success: true } | { success: false; existingLock: PidLockInfo } {
  const existingLock = getPidLock()

  if (existingLock) {
    // 检查该 PID 是否还在运行
    if (isProcessRunning(existingLock.pid)) {
      logger.warn(`Another daemon is already running (PID: ${existingLock.pid})`)
      return { success: false, existingLock }
    } else {
      // 僵尸 PID，清理掉
      logger.info(`Cleaning up stale PID file (PID: ${existingLock.pid} is not running)`)
      releasePidLock()
    }
  }

  // 写入新的 PID 文件
  const lockInfo: PidLockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
    command: process.argv.join(' '),
  }

  try {
    writeFileSync(PID_FILE, JSON.stringify(lockInfo, null, 2), 'utf-8')
    logger.info(`PID lock acquired: ${PID_FILE}`)
    return { success: true }
  } catch (error) {
    logger.error(`Failed to write PID file: ${error}`)
    return { success: false, existingLock: lockInfo }
  }
}

/**
 * 释放锁
 */
export function releasePidLock(): void {
  if (existsSync(PID_FILE)) {
    try {
      unlinkSync(PID_FILE)
      logger.info('PID lock released')
    } catch (error) {
      logger.warn(`Failed to delete PID file: ${error}`)
    }
  }
}

/**
 * 检查是否有守护进程在运行
 */
export function isDaemonRunning(): { running: boolean; lock?: PidLockInfo } {
  const lock = getPidLock()
  if (!lock) {
    return { running: false }
  }

  const running = isProcessRunning(lock.pid)
  return { running, lock }
}
