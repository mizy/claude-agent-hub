/**
 * JSON 文件读写工具
 *
 * 统一所有 JSON 文件操作，支持原子写入。
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, appendFileSync, unlinkSync, statSync } from 'fs'
import { dirname } from 'path'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { JsonReadOptions, JsonWriteOptions } from './types.js'

const logger = createLogger('json-io')

/**
 * 同步读取 JSON 文件
 *
 * @param filepath - 文件路径
 * @param options - 读取选项（支持 validate 回调做运行时校验）
 * @returns 解析后的 JSON 对象，文件不存在或解析失败返回 null
 */
export function readJson<T>(filepath: string, options?: JsonReadOptions): T | null {
  try {
    if (!existsSync(filepath)) {
      return (options?.defaultValue as T) ?? null
    }
    const content = readFileSync(filepath, 'utf-8')
    const parsed = JSON.parse(content) as T

    // Runtime validation if provided
    if (options?.validate && !options.validate(parsed)) {
      logger.warn(`JSON validation failed: ${filepath}`)
      return (options?.defaultValue as T) ?? null
    }

    return parsed
  } catch (e) {
    logger.debug(`Failed to read JSON: ${filepath} (${getErrorMessage(e)})`)
    return (options?.defaultValue as T) ?? null
  }
}

/**
 * 同步写入 JSON 文件
 *
 * 默认使用原子写入（先写临时文件再 rename），防止写入中断导致数据损坏。
 *
 * @param filepath - 文件路径
 * @param data - 要写入的数据
 * @param options - 写入选项
 */
export function writeJson(filepath: string, data: unknown, options?: JsonWriteOptions): void {
  const indent = options?.indent ?? 2
  const atomic = options?.atomic ?? true
  const content = JSON.stringify(data, null, indent)

  // 确保目录存在
  const dir = dirname(filepath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  if (atomic) {
    // 原子写入：先写临时文件，再 rename（pid+随机后缀避免多进程冲突）
    const suffix = Math.random().toString(36).slice(2, 8)
    const tempPath = `${filepath}.${process.pid}.${suffix}.tmp`
    writeFileSync(tempPath, content, 'utf-8')
    renameSync(tempPath, filepath)
  } else {
    // 直接写入
    writeFileSync(filepath, content, 'utf-8')
  }
}

/**
 * 追加内容到文件
 *
 * @param filepath - 文件路径
 * @param content - 要追加的内容
 */
export function appendToFile(filepath: string, content: string): void {
  const dir = dirname(filepath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  appendFileSync(filepath, content, 'utf-8')
}

/**
 * Synchronous file lock for protecting read-modify-write operations.
 * Uses exclusive file creation (wx flag) with stale lock detection.
 */
const LOCK_TIMEOUT_MS = 10_000
const LOCK_RETRY_COUNT = 20
const LOCK_RETRY_DELAY_MS = 50

export function withFileLock<T>(lockPath: string, fn: () => T): T {
  for (let i = 0; i < LOCK_RETRY_COUNT; i++) {
    try {
      writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        // Check if lock is stale (holder crashed)
        try {
          const age = Date.now() - statSync(lockPath).mtimeMs
          if (age >= LOCK_TIMEOUT_MS) {
            try { unlinkSync(lockPath) } catch { /* race ok */ }
          }
        } catch { /* lock removed between check */ }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_DELAY_MS)
        continue
      }
      throw e
    }

    try {
      return fn()
    } finally {
      try { unlinkSync(lockPath) } catch { /* already removed */ }
    }
  }

  throw new Error(`File lock timeout after ${LOCK_RETRY_COUNT} retries: ${lockPath}`)
}

/**
 * 确保目录存在
 *
 * @param dirpath - 目录路径
 */
export function ensureDir(dirpath: string): void {
  if (!existsSync(dirpath)) {
    mkdirSync(dirpath, { recursive: true })
  }
}

/**
 * 确保多个目录存在
 *
 * @param dirs - 目录路径数组
 */
export function ensureDirs(...dirs: string[]): void {
  for (const dir of dirs) {
    ensureDir(dir)
  }
}
