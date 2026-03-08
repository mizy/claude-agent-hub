/**
 * Vitest 全局设置
 * 在所有测试结束后清理测试产生的任务
 *
 * 注意：CAH_DATA_DIR 由 vitest.config.ts 设置为临时目录，
 * 确保测试绝不会删除生产数据。
 */

import { rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeAll, afterAll } from 'vitest'

const DATA_DIR = process.env.CAH_DATA_DIR || join(tmpdir(), 'cah-test-data')
const TASKS_DIR = join(DATA_DIR, 'tasks')
const MEMORY_DIR = join(DATA_DIR, 'memory')

// 安全检查：拒绝清理非临时目录
const isSafeDir = DATA_DIR.startsWith(tmpdir()) || DATA_DIR.includes('cah-test')

function cleanDir(dir: string) {
  if (!isSafeDir) return
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

// 测试开始前清理残留的内存目录，防止跨次测试运行的数据污染
beforeAll(() => {
  cleanDir(MEMORY_DIR)
})

afterAll(() => {
  if (!isSafeDir) {
    console.warn(`[setup] Refusing to clean non-temp data dir: ${DATA_DIR}`)
    return
  }
  cleanDir(TASKS_DIR)
  cleanDir(MEMORY_DIR)
})
