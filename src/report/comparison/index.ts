/**
 * 执行对比分析模块
 * 提供性能退化检测和任务对比功能
 */

// 类型定义
export type { TaskExecutionSnapshot, ComparisonResult } from './types.js'
export type { RegressionReport } from './DegradationDetector.js'

// 数据收集
export { collectTaskSnapshots, categorizeTask } from './dataCollector.js'

// 指标计算
export { calculateSimilarity, compareTasks } from './MetricCalculator.js'

// 退化检测
export { generateRegressionReport } from './DegradationDetector.js'

// 格式化输出
export {
  formatRegressionReportForTerminal,
  formatRegressionReportForMarkdown,
} from './formatters.js'
