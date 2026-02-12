/**
 * 趋势分析器模块
 * @module analyzers
 */

// 类型导出
export * from './types.js'

// 数据收集
export { collectAllTaskStats, groupByPeriod } from './dataCollector.js'
export { categorizeTask } from '../../analysis/index.js'

// 类型趋势分析
export {
  calculatePeriodTrend,
  analyzeNodePerformance,
  analyzeCategoryStats,
} from './TypeTrendAnalyzer.js'

// 热力图分析
export { analyzeNodeHeatmap } from './HeatmapAnalyzer.js'

// 成本分析
export {
  analyzeCostBreakdown,
  generateCostOptimizations,
  generateInsights,
} from './CostAnalyzer.js'

// 格式化
export { formatTrendReportForTerminal, formatTrendReportForMarkdown } from './formatters.js'
