/**
 * 执行对比分析类型定义
 */

import type { TaskCategory } from '../../analysis/index.js'

/** 任务执行快照 */
export interface TaskExecutionSnapshot {
  taskId: string
  title: string
  category: TaskCategory
  status: string
  createdAt: Date
  durationMs: number
  costUsd: number
  nodeCount: number
  nodeNames: string[]
  successRate: number
}

/** 执行对比结果 */
export interface ComparisonResult {
  task1: TaskExecutionSnapshot
  task2: TaskExecutionSnapshot
  /** 时间差异百分比 (正数表示 task2 更慢) */
  durationDiffPercent: number
  /** 成本差异百分比 */
  costDiffPercent: number
  /** 节点数差异 */
  nodeCountDiff: number
  /** 是否性能退化 */
  isRegression: boolean
  /** 差异分析 */
  analysis: string[]
}
