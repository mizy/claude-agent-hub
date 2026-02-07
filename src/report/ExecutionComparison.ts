/**
 * 执行对比分析
 * 对比相似任务的执行差异，识别性能退化
 *
 * 主要功能已拆分至 comparison/ 子模块：
 * - dataCollector.ts: 任务数据收集
 * - MetricCalculator.ts: 指标计算
 * - DegradationDetector.ts: 退化检测
 * - formatters.ts: 格式化输出
 */

// 导出所有公共 API
export type {
  TaskExecutionSnapshot,
  ComparisonResult,
  RegressionReport,
} from './comparison/index.js'

export {
  collectTaskSnapshots,
  categorizeTask,
  calculateSimilarity,
  compareTasks,
  generateRegressionReport,
  formatRegressionReportForTerminal,
  formatRegressionReportForMarkdown,
} from './comparison/index.js'

import {
  collectTaskSnapshots as _collectTaskSnapshots,
  compareTasks as _compareTasks,
} from './comparison/index.js'

// 兼容性 API：对比两个指定的任务
export function compareTasksById(
  taskId1: string,
  taskId2: string
): import('./comparison/types.js').ComparisonResult | null {
  const snapshots = _collectTaskSnapshots(90) // 扩大范围
  const t1 = snapshots.find(
    (s: { taskId: string }) => s.taskId === taskId1 || s.taskId.includes(taskId1)
  )
  const t2 = snapshots.find(
    (s: { taskId: string }) => s.taskId === taskId2 || s.taskId.includes(taskId2)
  )

  if (!t1 || !t2) {
    return null
  }

  return _compareTasks(t1, t2)
}
