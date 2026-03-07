/**
 * @entry Prompt Optimization 模块
 *
 * 自动分析任务失败原因，生成改进版 prompt，管理 prompt 版本生命周期。
 *
 * 主要 API:
 * - classifyFailure(): 基于规则的快速失败分类（LLM 前置判断）
 * - analyzeFailure / extractFailedNodes: 分析失败任务
 * - generateImprovement(): 基于失败分析生成改进版 prompt
 * - saveNewVersion / getActivePrompt / rollbackVersion / recordUsage: 版本管理
 * - compareVersions(): 版本对比
 * - extractSuccessPatterns / findMatchingPattern / savePattern / getAllPatterns: 成功模式提取
 * - recordFailure / getAllFailures / getFailuresByCategory / getFailuresByAgent
 *   getRecentFailures / computeFailureStats / formatFailureKnowledgeForPrompt: 失败知识库
 * - createABTest / selectVariant / evaluateABTest / concludeABTest
 *   calculateFitness / getRunningTest: A/B 测试
 * - runEvolutionCycle / refreshSuccessPatterns: 进化引擎
 */

// ============ 失败分类 ============

export { classifyFailure } from './classifyFailure.js'
export type { FailureClassification, FailureCategory } from './classifyFailure.js'

// ============ 失败分析 ============

export { analyzeFailure, extractFailedNodes } from './analyzeFailure.js'

// ============ 改进生成 ============

export { generateImprovement } from './generateImprovement.js'

// ============ 版本管理 ============

export {
  saveNewVersion,
  getActivePrompt,
  rollbackVersion,
  recordUsage,
} from './manageVersions.js'

// ============ 成功模式提取 ============

export {
  extractSuccessPatterns,
  findMatchingPattern,
  savePattern,
  getAllPatterns,
} from './extractSuccessPattern.js'
export type { SuccessPattern } from './extractSuccessPattern.js'

// ============ 版本对比 ============

export { compareVersions } from './compareVersions.js'
export type { VersionComparison } from './compareVersions.js'

// ============ 失败知识库 ============

export {
  recordFailure,
  getAllFailures,
  getFailuresByCategory,
  getFailuresByAgent,
  getRecentFailures,
  computeFailureStats,
  formatFailureKnowledgeForPrompt,
} from './failureKnowledgeBase.js'
export type { FailureRecord, FailureStats } from './failureKnowledgeBase.js'

// ============ A/B Testing ============

export {
  createABTest,
  selectVariant,
  evaluateABTest,
  concludeABTest,
  calculateFitness,
  getRunningTest,
} from './abTesting.js'
export type { ABTest, ABTestResult } from './abTesting.js'

// ============ 进化引擎 ============

export { runEvolutionCycle, refreshSuccessPatterns } from './evolutionSelection.js'
export type { EvolutionReport } from './evolutionSelection.js'
