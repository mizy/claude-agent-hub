#!/usr/bin/env tsx
/**
 * Medium 优先级配置验证脚本
 *
 * 验证内容：
 * 1. TaskPriority 类型定义
 * 2. 默认优先级设置
 * 3. 优先级参数解析
 */

import { createTask } from '../src/task/createTask.js'
import type { Task, TaskPriority } from '../src/types/task.js'
import { getStore } from '../src/store/index.js'

interface VerificationResult {
  item: string
  status: 'PASS' | 'FAIL'
  details: string
}

const results: VerificationResult[] = []

async function verify() {
  console.log('=== Medium 优先级配置验证 ===\n')

  // 1. 验证类型定义
  const validPriorities: TaskPriority[] = ['low', 'medium', 'high']
  results.push({
    item: '优先级类型定义',
    status: validPriorities.includes('medium') ? 'PASS' : 'FAIL',
    details: `有效优先级: ${validPriorities.join(', ')}`
  })

  // 2. 验证默认优先级
  const testTask1 = await createTask({
    title: 'Test Task - Default Priority'
  })
  results.push({
    item: '默认优先级',
    status: testTask1.priority === 'medium' ? 'PASS' : 'FAIL',
    details: `期望: medium, 实际: ${testTask1.priority}`
  })

  // 3. 验证显式设置 medium 优先级
  const testTask2 = await createTask({
    title: 'Test Task - Explicit Medium',
    priority: 'medium'
  })
  results.push({
    item: '显式设置 medium',
    status: testTask2.priority === 'medium' ? 'PASS' : 'FAIL',
    details: `期望: medium, 实际: ${testTask2.priority}`
  })

  // 4. 验证其他优先级
  const testTask3 = await createTask({
    title: 'Test Task - High Priority',
    priority: 'high'
  })
  results.push({
    item: '设置 high 优先级',
    status: testTask3.priority === 'high' ? 'PASS' : 'FAIL',
    details: `期望: high, 实际: ${testTask3.priority}`
  })

  const testTask4 = await createTask({
    title: 'Test Task - Low Priority',
    priority: 'low'
  })
  results.push({
    item: '设置 low 优先级',
    status: testTask4.priority === 'low' ? 'PASS' : 'FAIL',
    details: `期望: low, 实际: ${testTask4.priority}`
  })

  // 5. 验证任务持久化
  const store = getStore()
  const loadedTask = store.getTask(testTask2.id)
  results.push({
    item: '优先级持久化',
    status: loadedTask?.priority === 'medium' ? 'PASS' : 'FAIL',
    details: `从存储加载的优先级: ${loadedTask?.priority || 'null'}`
  })

  // 清理测试任务
  try {
    for (const task of [testTask1, testTask2, testTask3, testTask4]) {
      store.deleteTaskFolder(task.id)
    }
  } catch (e) {
    // 忽略清理错误
  }

  // 输出结果
  console.log('\n=== 验证结果 ===\n')

  const passCount = results.filter(r => r.status === 'PASS').length
  const failCount = results.filter(r => r.status === 'FAIL').length

  for (const result of results) {
    const icon = result.status === 'PASS' ? '✓' : '✗'
    const color = result.status === 'PASS' ? '\x1b[32m' : '\x1b[31m'
    console.log(`${color}${icon}\x1b[0m ${result.item}`)
    console.log(`  ${result.details}\n`)
  }

  console.log(`\n总计: ${passCount} 通过, ${failCount} 失败`)

  if (failCount > 0) {
    console.log('\n❌ 验证失败')
    process.exit(1)
  } else {
    console.log('\n✅ 所有验证通过')
    process.exit(0)
  }
}

// 执行验证
verify().catch(err => {
  console.error('\n验证过程出错:', err)
  process.exit(1)
})
