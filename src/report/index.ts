/**
 * @entry Report 模块
 *
 * 提供任务执行报告、趋势分析和实时监控能力
 */

// ============ 基础报告 ============

export { generateReport } from './generateReport.js'
export { formatReport } from './formatReport.js'

// ============ 单任务执行报告 ============

export {
  generateExecutionReport,
  formatReportForTerminal,
  formatReportForMarkdown,
  type ExecutionReport,
  type NodeReport,
  type ConversationSummary,
} from './ExecutionReport.js'

// ============ 趋势分析 ============

export {
  generateTrendReport,
  formatTrendReportForTerminal,
  formatTrendReportForMarkdown,
  type TrendPeriod,
  type TrendReport,
  type CategoryStats,
  type CostOptimization,
  type ExecutionTrend,
  type NodePerformance,
  type CostBreakdown,
} from './TrendAnalyzer.js'

// ============ 实时监控 ============

export {
  generateLiveSummary,
  formatLiveSummaryForTerminal,
  formatLiveSummaryForJson,
  type RunningTaskInfo,
  type QueuedTaskInfo,
  type TodaySummary,
  type LiveSummaryReport,
} from './LiveSummary.js'

// ============ 执行对比 ============

export {
  compareTasksById,
  generateRegressionReport,
  formatRegressionReportForTerminal,
  formatRegressionReportForMarkdown,
  type TaskExecutionSnapshot,
  type ComparisonResult,
  type RegressionReport,
} from './ExecutionComparison.js'
