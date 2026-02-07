/**
 * PID 文件锁 - 防止多个服务实例同时运行
 *
 * 支持 daemon 和 dashboard 两种服务
 */

import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { DATA_DIR } from '../store/paths.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('pid-lock')

export type ServiceName = 'daemon' | 'dashboard'

function pidFilePath(service: ServiceName): string {
  return join(DATA_DIR, `${service}.pid`)
}

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
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 获取 PID 锁信息
 */
export function getPidLock(service: ServiceName = 'daemon'): PidLockInfo | null {
  const file = pidFilePath(service)
  if (!existsSync(file)) {
    return null
  }

  try {
    const content = readFileSync(file, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    logger.warn(`Failed to read PID file: ${error}`)
    return null
  }
}

/**
 * 尝试获取锁
 */
export function acquirePidLock(
  service: ServiceName = 'daemon'
): { success: true } | { success: false; existingLock: PidLockInfo } {
  const existingLock = getPidLock(service)

  if (existingLock) {
    if (isProcessRunning(existingLock.pid)) {
      logger.warn(`Another ${service} is already running (PID: ${existingLock.pid})`)
      return { success: false, existingLock }
    } else {
      logger.info(`Cleaning up stale PID file (PID: ${existingLock.pid} is not running)`)
      releasePidLock(service)
    }
  }

  const lockInfo: PidLockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
    command: process.argv.join(' '),
  }

  const file = pidFilePath(service)
  try {
    writeFileSync(file, JSON.stringify(lockInfo, null, 2), 'utf-8')
    logger.info(`PID lock acquired: ${file}`)
    return { success: true }
  } catch (error) {
    logger.error(`Failed to write PID file: ${error}`)
    return { success: false, existingLock: lockInfo }
  }
}

/**
 * 释放锁
 */
export function releasePidLock(service: ServiceName = 'daemon'): void {
  const file = pidFilePath(service)
  if (existsSync(file)) {
    try {
      unlinkSync(file)
      logger.info(`PID lock released: ${service}`)
    } catch (error) {
      logger.warn(`Failed to delete PID file: ${error}`)
    }
  }
}

/**
 * 检查服务是否在运行
 */
export function isServiceRunning(
  service: ServiceName = 'daemon'
): { running: boolean; lock?: PidLockInfo } {
  const lock = getPidLock(service)
  if (!lock) {
    return { running: false }
  }

  const running = isProcessRunning(lock.pid)
  return { running, lock }
}

/** @deprecated Use isServiceRunning('daemon') */
export const isDaemonRunning = () => isServiceRunning('daemon')
