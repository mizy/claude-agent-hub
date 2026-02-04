/**
 * 并发创建任务测试数据（测试任务 4）
 * 提供并发任务创建场景的标准化测试数据和验证工具
 */

import type { TaskPriority } from '../../src/types/task.js'

/**
 * 并发创建测试场景配置
 */
export interface ConcurrentCreationScenario {
  name: string
  description: string
  taskCount: number
  priority: TaskPriority
  expectedBehavior: string[]
  validationRules: ValidationRule[]
}

/**
 * 验证规则
 */
export interface ValidationRule {
  name: string
  validator: (results: TaskCreationResult[]) => ValidationResult
}

/**
 * 任务创建结果
 */
export interface TaskCreationResult {
  taskId: string
  success: boolean
  error?: string
  createdAt: number
  duration: number
}

/**
 * 验证结果
 */
export interface ValidationResult {
  passed: boolean
  message: string
  details?: Record<string, unknown>
}

/**
 * 测试任务 4 的场景配置
 */
export const TASK4_SCENARIOS: ConcurrentCreationScenario[] = [
  {
    name: '小规模并发创建',
    description: '同时创建 3 个任务，验证基本并发能力',
    taskCount: 3,
    priority: 'medium',
    expectedBehavior: [
      '所有任务应成功创建',
      '所有任务 ID 应唯一',
      '任务文件夹应正确创建',
      '无资源冲突',
    ],
    validationRules: [
      {
        name: 'unique-ids',
        validator: validateUniqueIds,
      },
      {
        name: 'all-success',
        validator: validateAllSuccess,
      },
      {
        name: 'reasonable-duration',
        validator: validateReasonableDuration,
      },
    ],
  },
  {
    name: '中等规模并发创建',
    description: '同时创建 5 个任务，测试中等负载',
    taskCount: 5,
    priority: 'medium',
    expectedBehavior: [
      '所有任务应成功创建',
      '所有任务 ID 应唯一',
      '创建时间戳应递增',
      '文件系统操作无冲突',
    ],
    validationRules: [
      {
        name: 'unique-ids',
        validator: validateUniqueIds,
      },
      {
        name: 'all-success',
        validator: validateAllSuccess,
      },
      {
        name: 'timestamp-order',
        validator: validateTimestampOrder,
      },
      {
        name: 'reasonable-duration',
        validator: validateReasonableDuration,
      },
    ],
  },
  {
    name: '大规模并发创建',
    description: '同时创建 10 个任务，测试高并发场景',
    taskCount: 10,
    priority: 'medium',
    expectedBehavior: [
      '所有任务应成功创建',
      '所有任务 ID 应唯一',
      '性能在可接受范围内',
      '无死锁或资源竞争',
    ],
    validationRules: [
      {
        name: 'unique-ids',
        validator: validateUniqueIds,
      },
      {
        name: 'all-success',
        validator: validateAllSuccess,
      },
      {
        name: 'performance',
        validator: validatePerformance,
      },
      {
        name: 'no-conflicts',
        validator: validateNoConflicts,
      },
    ],
  },
]

/**
 * 生成测试任务描述
 */
export function generateTaskDescriptions(count: number): string[] {
  const templates = [
    '分析项目代码结构',
    '生成测试报告',
    '优化性能瓶颈',
    '重构核心模块',
    '更新文档',
    '修复已知bug',
    '添加新功能',
    '执行代码审查',
  ]

  const descriptions: string[] = []
  for (let i = 0; i < count; i++) {
    const template = templates[i % templates.length]
    const suffix = i >= templates.length ? ` (批次 ${Math.floor(i / templates.length) + 1})` : ''
    descriptions.push(`${template}${suffix}`)
  }

  return descriptions
}

/**
 * 验证规则实现
 */

// 验证所有任务 ID 唯一
function validateUniqueIds(results: TaskCreationResult[]): ValidationResult {
  const taskIds = results.map(r => r.taskId)
  const uniqueIds = new Set(taskIds)

  if (uniqueIds.size === taskIds.length) {
    return {
      passed: true,
      message: `所有 ${taskIds.length} 个任务 ID 均唯一`,
      details: { totalIds: taskIds.length, uniqueCount: uniqueIds.size },
    }
  } else {
    const duplicates = taskIds.filter((id, index) => taskIds.indexOf(id) !== index)
    return {
      passed: false,
      message: `发现重复的任务 ID: ${duplicates.join(', ')}`,
      details: { totalIds: taskIds.length, uniqueCount: uniqueIds.size, duplicates },
    }
  }
}

// 验证所有任务创建成功
function validateAllSuccess(results: TaskCreationResult[]): ValidationResult {
  const failed = results.filter(r => !r.success)

  if (failed.length === 0) {
    return {
      passed: true,
      message: `所有 ${results.length} 个任务创建成功`,
      details: { total: results.length, succeeded: results.length, failed: 0 },
    }
  } else {
    return {
      passed: false,
      message: `${failed.length} 个任务创建失败`,
      details: {
        total: results.length,
        succeeded: results.length - failed.length,
        failed: failed.length,
        errors: failed.map(r => ({ taskId: r.taskId, error: r.error })),
      },
    }
  }
}

// 验证时间戳顺序
function validateTimestampOrder(results: TaskCreationResult[]): ValidationResult {
  const timestamps = results.map(r => r.createdAt)
  const isOrdered = timestamps.every((ts, index) => index === 0 || ts >= timestamps[index - 1])

  if (isOrdered) {
    return {
      passed: true,
      message: '所有任务的创建时间戳符合预期顺序',
      details: { timestamps },
    }
  } else {
    return {
      passed: false,
      message: '任务创建时间戳顺序异常',
      details: { timestamps },
    }
  }
}

// 验证性能（平均创建时间应在合理范围内）
function validatePerformance(results: TaskCreationResult[]): ValidationResult {
  const durations = results.map(r => r.duration)
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
  const maxDuration = Math.max(...durations)
  const threshold = 5000 // 5秒

  if (avgDuration < threshold && maxDuration < threshold * 2) {
    return {
      passed: true,
      message: `性能良好：平均 ${avgDuration.toFixed(0)}ms，最大 ${maxDuration.toFixed(0)}ms`,
      details: { avgDuration, maxDuration, threshold },
    }
  } else {
    return {
      passed: false,
      message: `性能不佳：平均 ${avgDuration.toFixed(0)}ms，最大 ${maxDuration.toFixed(0)}ms`,
      details: { avgDuration, maxDuration, threshold },
    }
  }
}

// 验证创建耗时合理
function validateReasonableDuration(results: TaskCreationResult[]): ValidationResult {
  const durations = results.map(r => r.duration)
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
  const threshold = 3000 // 3秒

  if (avgDuration < threshold) {
    return {
      passed: true,
      message: `创建耗时合理：平均 ${avgDuration.toFixed(0)}ms`,
      details: { avgDuration, threshold },
    }
  } else {
    return {
      passed: false,
      message: `创建耗时过长：平均 ${avgDuration.toFixed(0)}ms`,
      details: { avgDuration, threshold },
    }
  }
}

// 验证无冲突
function validateNoConflicts(results: TaskCreationResult[]): ValidationResult {
  // 检查是否有因文件系统冲突导致的失败
  const conflictErrors = results.filter(r =>
    r.error?.toLowerCase().includes('conflict') ||
    r.error?.toLowerCase().includes('exists') ||
    r.error?.toLowerCase().includes('eexist')
  )

  if (conflictErrors.length === 0) {
    return {
      passed: true,
      message: '未检测到资源冲突',
      details: { total: results.length, conflicts: 0 },
    }
  } else {
    return {
      passed: false,
      message: `检测到 ${conflictErrors.length} 个资源冲突`,
      details: {
        total: results.length,
        conflicts: conflictErrors.length,
        errors: conflictErrors.map(r => ({ taskId: r.taskId, error: r.error })),
      },
    }
  }
}

/**
 * 执行场景验证
 */
export function validateScenario(
  scenario: ConcurrentCreationScenario,
  results: TaskCreationResult[]
): {
  scenarioName: string
  passed: boolean
  validationResults: Record<string, ValidationResult>
  summary: string
} {
  const validationResults: Record<string, ValidationResult> = {}

  for (const rule of scenario.validationRules) {
    validationResults[rule.name] = rule.validator(results)
  }

  const allPassed = Object.values(validationResults).every(r => r.passed)
  const passedCount = Object.values(validationResults).filter(r => r.passed).length
  const totalCount = Object.values(validationResults).length

  return {
    scenarioName: scenario.name,
    passed: allPassed,
    validationResults,
    summary: `验证结果：${passedCount}/${totalCount} 项通过`,
  }
}

/**
 * 生成测试报告
 */
export function generateTestReport(
  scenario: ConcurrentCreationScenario,
  results: TaskCreationResult[],
  validationResult: ReturnType<typeof validateScenario>
): string {
  const lines: string[] = []

  lines.push(`# 并发创建测试报告 - ${scenario.name}`)
  lines.push('')
  lines.push(`## 测试场景`)
  lines.push(`- **名称**: ${scenario.name}`)
  lines.push(`- **描述**: ${scenario.description}`)
  lines.push(`- **任务数量**: ${scenario.taskCount}`)
  lines.push(`- **优先级**: ${scenario.priority}`)
  lines.push('')

  lines.push(`## 预期行为`)
  for (const behavior of scenario.expectedBehavior) {
    lines.push(`- ${behavior}`)
  }
  lines.push('')

  lines.push(`## 执行结果`)
  lines.push(`- **总任务数**: ${results.length}`)
  lines.push(`- **成功数**: ${results.filter(r => r.success).length}`)
  lines.push(`- **失败数**: ${results.filter(r => !r.success).length}`)
  lines.push('')

  lines.push(`## 验证结果`)
  lines.push(`**状态**: ${validationResult.passed ? '✅ 通过' : '❌ 失败'}`)
  lines.push('')

  for (const [ruleName, result] of Object.entries(validationResult.validationResults)) {
    lines.push(`### ${ruleName}`)
    lines.push(`- **状态**: ${result.passed ? '✅ 通过' : '❌ 失败'}`)
    lines.push(`- **说明**: ${result.message}`)
    if (result.details) {
      lines.push(`- **详情**: \`${JSON.stringify(result.details)}\``)
    }
    lines.push('')
  }

  lines.push(`## 总结`)
  lines.push(validationResult.summary)
  lines.push('')

  return lines.join('\n')
}
