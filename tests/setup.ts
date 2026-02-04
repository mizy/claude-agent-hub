/**
 * Vitest 全局设置
 * 在所有测试结束后清理测试产生的任务
 */

import { rmSync, existsSync } from 'fs'
import { join } from 'path'
import { afterAll } from 'vitest'

const DATA_DIR = process.env.CAH_DATA_DIR || join(process.cwd(), '.cah-data')
const TASKS_DIR = join(DATA_DIR, 'tasks')

afterAll(() => {
  // 清理测试产生的任务
  if (existsSync(TASKS_DIR)) {
    try {
      rmSync(TASKS_DIR, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})
