/**
 * @entry Report 模块
 *
 * 任务执行报告、趋势分析、实时监控、执行对比与回归检测
 *
 * 能力分组：
 * - 工作报告: generateReport/formatReport（按 agent/时间筛选）
 * - 执行报告: generateExecutionReport + Terminal/Markdown 格式化（单任务节点级统计）
 * - 趋势分析: generateTrendReport + Terminal/Markdown 格式化（多周期性能、成本、热力图）
 * - 实时监控: generateLiveSummary + Terminal/JSON 格式化（运行中/排队任务、今日统计）
 * - 执行对比: compareTasksById/generateRegressionReport + Terminal/Markdown 格式化（回归检测）
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
