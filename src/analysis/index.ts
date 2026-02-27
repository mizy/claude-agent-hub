/**
 * @entry Analysis 分析模块
 *
 * 项目上下文分析、历史学习、任务分类、模式识别、时间预估
 *
 * 能力分组：
 * - 项目上下文: analyzeProjectContext/formatProjectContextForPrompt
 * - 历史学习: learnFromHistory/getTaskHistory/formatInsightsForPrompt
 * - 任务分类: categorizeTask/extractKeywords
 * - 模式识别: extractSuccessfulNodePatterns/getRecommendedNodeCountByCategory/addCategorySpecificAdvice
 * - 时间预估: estimateNodeDuration/estimateRemainingTime/formatTimeEstimate/clearCache
 */

// ============ 项目上下文 ============

export {
  analyzeProjectContext,
  formatProjectContextForPrompt,
  type ProjectContext,
} from './analyzeProjectContext.js'

// ============ 历史学习 ============

export {
  learnFromHistory,
  getTaskHistory,
  formatInsightsForPrompt,
  type TaskCategory,
  type NodePattern,
  type TaskHistoryEntry,
  type LearningInsights,
} from './learnFromHistory.js'

// ============ 内部模块（按需导出） ============

export { categorizeTask, extractKeywords } from './TaskClassifier.js'

export {
  extractSuccessfulNodePatterns,
  getRecommendedNodeCountByCategory,
  addCategorySpecificAdvice,
} from './PatternRecognizer.js'

// ============ 时间预估 ============

export {
  estimateNodeDuration,
  estimateRemainingTime,
  formatTimeEstimate,
  clearCache,
  type TimeEstimate,
} from './estimateTime.js'
