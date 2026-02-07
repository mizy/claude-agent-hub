/**
 * Medium 优先级测试环境初始化脚本
 * 验证测试环境配置和依赖
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createTask } from '../../src/task/createTask'
import { getTask } from '../../src/store/TaskStore'

export interface TestEnvResult {
  success: boolean
  message: string
  details: {
    taskId?: string
    priority?: string
    createdAt?: string
    configValid: boolean
    storeAccessible: boolean
  }
}

/**
 * 初始化测试环境
 */
export async function initMediumTestEnv(): Promise<TestEnvResult> {
  const details = {
    configValid: false,
    storeAccessible: false,
  }

  try {
    // 1. 检查数据目录
    const dataDir = process.env.CAH_DATA_DIR || resolve(tmpdir(), 'cah-test-data')
    const tasksDir = resolve(dataDir, 'tasks')

    if (!existsSync(tasksDir)) {
      return {
        success: false,
        message: '任务存储目录不存在',
        details,
      }
    }

    details.storeAccessible = true

    // 2. 创建测试任务
    const task = await createTask({
      title: 'Medium优先级测试初始化任务',
      description: '用于验证 medium 优先级任务配置的测试任务',
      priority: 'medium',
    })

    details.taskId = task.id
    details.priority = task.priority
    details.createdAt = task.createdAt

    // 3. 验证任务元数据
    const retrieved = await getTask(task.id)

    if (retrieved.priority !== 'medium') {
      return {
        success: false,
        message: `任务优先级不匹配: 期望 'medium', 实际 '${retrieved.priority}'`,
        details,
      }
    }

    if (!retrieved.id || !retrieved.createdAt) {
      return {
        success: false,
        message: '任务元数据不完整',
        details,
      }
    }

    details.configValid = true

    return {
      success: true,
      message: '测试环境初始化成功',
      details,
    }
  } catch (error) {
    return {
      success: false,
      message: `初始化失败: ${error instanceof Error ? error.message : String(error)}`,
      details,
    }
  }
}

/**
 * 打印测试环境报告
 */
export function printTestEnvReport(result: TestEnvResult): void {
  console.log('\n=== Medium 优先级测试环境初始化报告 ===\n')
  console.log(`状态: ${result.success ? '✓ 成功' : '✗ 失败'}`)
  console.log(`消息: ${result.message}`)
  console.log('\n详细信息:')
  console.log(`  - 存储可访问: ${result.details.storeAccessible ? '✓' : '✗'}`)
  console.log(`  - 配置有效: ${result.details.configValid ? '✓' : '✗'}`)

  if (result.details.taskId) {
    console.log(`  - 任务 ID: ${result.details.taskId}`)
    console.log(`  - 优先级: ${result.details.priority}`)
    console.log(`  - 创建时间: ${result.details.createdAt}`)
  }

  console.log('\n========================================\n')
}

// 直接执行时运行初始化
if (import.meta.url === `file://${process.argv[1]}`) {
  initMediumTestEnv().then(result => {
    printTestEnvReport(result)
    process.exit(result.success ? 0 : 1)
  })
}
