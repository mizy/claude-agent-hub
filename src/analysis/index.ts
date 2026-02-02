/**
 * @entry Analysis 分析模块
 *
 * 提供项目上下文分析、历史学习和时间预估能力
 *
 * 主要 API:
 * - analyzeProjectContext(): 分析项目上下文
 * - learnFromHistory(): 从历史任务学习
 * - estimateRemainingTime(): 预估剩余时间
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
  formatDuration,
  formatTimeEstimate,
  clearCache,
  type TimeEstimate,
} from './estimateTime.js'
