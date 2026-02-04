/**
 * 测试任务 4 配置文件
 * 包含测试参数、环境配置、超时设置等
 */

import { join } from 'path'
import { tmpdir } from 'os'

/**
 * 测试环境配置
 */
export interface Task4TestConfig {
  // 数据目录
  dataDir: string
  // 测试超时时间（毫秒）
  timeout: number
  // 是否在测试后清理数据
  cleanupAfterTest: boolean
  // 并发测试配置
  concurrency: {
    smallScale: number
    mediumScale: number
    largeScale: number
  }
  // 性能阈值
  performance: {
    maxAvgDuration: number // 最大平均创建时间（毫秒）
    maxSingleDuration: number // 单个任务最大创建时间（毫秒）
  }
  // 重试配置
  retry: {
    enabled: boolean
    maxAttempts: number
    delay: number
  }
}

/**
 * 默认测试配置
 */
export const DEFAULT_TASK4_CONFIG: Task4TestConfig = {
  dataDir: join(tmpdir(), `cah-test-task4-${Date.now()}`),
  timeout: 30000, // 30秒
  cleanupAfterTest: true,
  concurrency: {
    smallScale: 3,
    mediumScale: 5,
    largeScale: 10,
  },
  performance: {
    maxAvgDuration: 3000, // 平均 3秒
    maxSingleDuration: 5000, // 单个 5秒
  },
  retry: {
    enabled: false, // 测试时不重试
    maxAttempts: 1,
    delay: 0,
  },
}

/**
 * 获取测试配置（可从环境变量覆盖）
 */
export function getTask4TestConfig(): Task4TestConfig {
  const config = { ...DEFAULT_TASK4_CONFIG }

  // 从环境变量读取配置
  if (process.env.CAH_TEST_DATA_DIR) {
    config.dataDir = process.env.CAH_TEST_DATA_DIR
  }

  if (process.env.CAH_TEST_TIMEOUT) {
    config.timeout = parseInt(process.env.CAH_TEST_TIMEOUT, 10)
  }

  if (process.env.CAH_TEST_CLEANUP === 'false') {
    config.cleanupAfterTest = false
  }

  return config
}

/**
 * 测试场景枚举
 */
export enum TestScenario {
  SMALL_SCALE = 'small-scale',
  MEDIUM_SCALE = 'medium-scale',
  LARGE_SCALE = 'large-scale',
}

/**
 * 获取场景对应的任务数量
 */
export function getTaskCountForScenario(
  scenario: TestScenario,
  config: Task4TestConfig = DEFAULT_TASK4_CONFIG
): number {
  switch (scenario) {
    case TestScenario.SMALL_SCALE:
      return config.concurrency.smallScale
    case TestScenario.MEDIUM_SCALE:
      return config.concurrency.mediumScale
    case TestScenario.LARGE_SCALE:
      return config.concurrency.largeScale
    default:
      return config.concurrency.smallScale
  }
}

/**
 * 测试报告路径配置
 */
export const TASK4_REPORT_PATHS = {
  baseDir: 'tests/reports/concurrent-creation',
  scenarios: {
    [TestScenario.SMALL_SCALE]: 'small-scale',
    [TestScenario.MEDIUM_SCALE]: 'medium-scale',
    [TestScenario.LARGE_SCALE]: 'large-scale',
  },
  files: {
    report: 'test-report.md',
    results: 'test-results.json',
    summary: 'test-summary.json',
  },
}

/**
 * 生成报告文件路径
 */
export function getReportPath(scenario: TestScenario, fileName: string): string {
  const scenarioDir = TASK4_REPORT_PATHS.scenarios[scenario]
  return join(TASK4_REPORT_PATHS.baseDir, scenarioDir, fileName)
}

/**
 * Mock 数据配置
 */
export const MOCK_CONFIG = {
  // Mock 任务描述模板
  taskDescriptions: [
    '分析项目代码结构',
    '生成测试报告',
    '优化性能瓶颈',
    '重构核心模块',
    '更新文档',
    '修复已知bug',
    '添加新功能',
    '执行代码审查',
    '集成新依赖',
    '部署到生产环境',
  ],

  // Mock 优先级分布
  priorityDistribution: {
    low: 0.2,
    medium: 0.6,
    high: 0.2,
  },

  // Mock 工作流节点
  workflowNodes: [
    { id: 'start', type: 'start', name: '开始' },
    { id: 'task-1', type: 'task', name: '执行任务' },
    { id: 'end', type: 'end', name: '结束' },
  ],
}

/**
 * 测试统计指标
 */
export interface TestMetrics {
  // 任务创建
  totalTasks: number
  successfulCreations: number
  failedCreations: number
  successRate: number

  // 性能指标
  avgCreationTime: number
  minCreationTime: number
  maxCreationTime: number
  p95CreationTime: number

  // ID 唯一性
  uniqueIds: number
  duplicateIds: number

  // 时间戳
  timestampRange: {
    earliest: number
    latest: number
    span: number
  }
}

/**
 * 计算测试指标
 */
export function calculateMetrics(
  results: Array<{
    taskId: string
    success: boolean
    createdAt: number
    duration: number
  }>
): TestMetrics {
  const taskIds = results.map(r => r.taskId)
  const uniqueIds = new Set(taskIds)
  const durations = results.map(r => r.duration)
  const timestamps = results.map(r => r.createdAt)

  const sortedDurations = [...durations].sort((a, b) => a - b)
  const p95Index = Math.floor(sortedDurations.length * 0.95)

  return {
    totalTasks: results.length,
    successfulCreations: results.filter(r => r.success).length,
    failedCreations: results.filter(r => !r.success).length,
    successRate: results.filter(r => r.success).length / results.length,

    avgCreationTime: durations.reduce((a, b) => a + b, 0) / durations.length,
    minCreationTime: Math.min(...durations),
    maxCreationTime: Math.max(...durations),
    p95CreationTime: sortedDurations[p95Index] ?? 0,

    uniqueIds: uniqueIds.size,
    duplicateIds: taskIds.length - uniqueIds.size,

    timestampRange: {
      earliest: Math.min(...timestamps),
      latest: Math.max(...timestamps),
      span: Math.max(...timestamps) - Math.min(...timestamps),
    },
  }
}
