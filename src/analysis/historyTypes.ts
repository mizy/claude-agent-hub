/**
 * 执行历史类型定义
 */

import type { TaskCategory } from './TaskClassifier.js'

/**
 * 节点模式
 */
export interface NodePattern {
  /** 模式名称 */
  name: string
  /** 节点序列 */
  nodeSequence: string[]
  /** 出现次数 */
  occurrences: number
  /** 平均成功率 */
  successRate: number
}

/**
 * 历史任务摘要
 */
export interface TaskHistoryEntry {
  /** 任务 ID */
  taskId: string
  /** 任务标题 */
  title: string
  /** 任务描述 */
  description?: string
  /** 任务类型 */
  category: TaskCategory
  /** 执行状态 */
  status: string
  /** 节点数量 */
  nodeCount: number
  /** 节点名称列表 */
  nodeNames?: string[]
  /** 失败节点 */
  failedNodes?: string[]
  /** 失败原因 */
  failureReasons?: string[]
  /** 执行时长（秒） */
  durationSec?: number
  /** 创建时间 */
  createdAt: string
}

/**
 * 学习建议
 */
export interface LearningInsights {
  /** 任务分类 */
  taskCategory: TaskCategory
  /** 相似任务的成功模式 */
  successPatterns: string[]
  /** 常见失败原因 */
  commonFailures: string[]
  /** 推荐的节点粒度 */
  recommendedNodeCount?: number
  /** 成功的节点模式 */
  successfulNodePatterns: NodePattern[]
  /** 相关历史任务 */
  relatedTasks: TaskHistoryEntry[]
}
