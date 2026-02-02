/**
 * 趋势分析器共享类型定义
 */

import type { TaskCategory } from '../../analysis/index.js'
import type { ExecutionSummary, ExecutionTimeline } from '../../store/ExecutionStatsStore.js'
import type { NodeExecutionStats } from '../../workflow/engine/WorkflowEventEmitter.js'

export interface TrendPeriod {
  label: string
  startDate: Date
  endDate: Date
}

/** 任务类型统计 */
export interface CategoryStats {
  category: TaskCategory
  taskCount: number
  successRate: number
  avgDurationMs: number
  totalCostUsd: number
  avgNodeCount: number
}

/** 节点组合热力图数据 */
export interface NodeCombination {
  /** 节点组合 (如 "分析代码 → 实现功能") */
  combination: string
  /** 出现次数 */
  count: number
  /** 成功率 */
  successRate: number
  /** 平均执行时间 */
  avgDurationMs: number
}

/** 成本优化建议 */
export interface CostOptimization {
  /** 优化类型 */
  type: 'high_cost_node' | 'redundant_nodes' | 'batch_opportunity' | 'retry_waste'
  /** 建议描述 */
  suggestion: string
  /** 潜在节省金额 */
  potentialSavingUsd: number
  /** 影响的节点或任务 */
  affectedItems: string[]
}

export interface ExecutionTrend {
  period: TrendPeriod
  taskCount: number
  successRate: number
  avgDurationMs: number
  totalCostUsd: number
  avgNodesPerTask: number
  failureReasons: { reason: string; count: number }[]
  /** 按类型分布 */
  categoryBreakdown?: { category: TaskCategory; count: number }[]
}

export interface NodePerformance {
  nodeName: string
  nodeType: string
  executionCount: number
  avgDurationMs: number
  successRate: number
  totalCostUsd: number
}

export interface CostBreakdown {
  totalCostUsd: number
  byDate: { date: string; costUsd: number }[]
  byNodeType: { nodeType: string; costUsd: number; percentage: number }[]
  avgCostPerTask: number
  avgCostPerNode: number
}

export interface TrendReport {
  generatedAt: string
  periodStart: Date
  periodEnd: Date
  trends: ExecutionTrend[]
  nodePerformance: NodePerformance[]
  costBreakdown: CostBreakdown
  insights: string[]
  /** 按任务类型的统计 */
  categoryStats: CategoryStats[]
  /** 节点组合热力图 */
  nodeHeatmap: NodeCombination[]
  /** 成本优化建议 */
  costOptimizations: CostOptimization[]
}

/** 任务统计数据（内部使用） */
export interface TaskStats {
  taskId: string
  createdAt: Date
  summary: ExecutionSummary
  nodes: NodeExecutionStats[]
  timeline: ExecutionTimeline[]
  /** 任务类型 */
  category?: TaskCategory
  /** 节点名称序列 */
  nodeNames?: string[]
}
