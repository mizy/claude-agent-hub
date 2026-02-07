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
import { afterAll } from 'vitest'

const DATA_DIR = process.env.CAH_DATA_DIR || join(tmpdir(), 'cah-test-data')
const TASKS_DIR = join(DATA_DIR, 'tasks')

// 安全检查：拒绝清理非临时目录
const isSafeDir = DATA_DIR.startsWith(tmpdir()) || DATA_DIR.includes('cah-test')

afterAll(() => {
  if (!isSafeDir) {
    console.warn(`[setup] Refusing to clean non-temp data dir: ${DATA_DIR}`)
    return
  }
  if (existsSync(TASKS_DIR)) {
    try {
      rmSync(TASKS_DIR, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})
