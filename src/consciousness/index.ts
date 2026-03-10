/**
 * @entry Consciousness 意识流模块
 *
 * 记录和检索 Agent 的意识流条目，用于上下文感知
 *
 * 主要 API:
 * - appendEntry / getRecentEntries / formatForPrompt: 意识流存储与格式化
 * - generateSessionEndInsight: 会话结束洞察生成
 * - registerConsciousnessListeners: 事件监听注册
 * - SelfModel / loadSelfModel / saveSelfModel: 自我认知模型
 * - ReflectionEntry / appendConsciousnessLog / readConsciousnessLogs: 反思日志
 */
export type { ConsciousnessEntry } from './types.js'
export { appendEntry, getRecentEntries, formatForPrompt } from './consciousnessStore.js'
export { generateSessionEndInsight, type ConversationMessage, type SessionEndInsight } from './generateSummary.js'
export { registerConsciousnessListeners } from './registerConsciousnessListeners.js'
export type { SelfModel, ReflectionEntry } from './selfModel.js'
export {
  createDefaultSelfModel,
  loadSelfModel,
  saveSelfModel,
  appendConsciousnessLog,
  readConsciousnessLogs,
} from './selfModel.js'
export { runDailyReflection } from './reflectionRunner.js'
export { registerGrowthJournalListeners } from './registerGrowthJournalListeners.js'
export type { GrowthJournalEntry, GrowthChangeType, GrowthMetrics, GrowthSummary } from './growthJournal.js'
export { recordGrowth, loadGrowthJournal, getGrowthSummary, getMilestones } from './growthJournal.js'
export type { EvolutionMetrics } from './computeEvolutionMetrics.js'
export { computeTaskMetrics } from './computeEvolutionMetrics.js'
export { runWeeklyNarrative } from './narrativeRunner.js'
export { registerValueListeners } from './registerValueListeners.js'
export { recordApproveSignal, recordRejectSignal, recordRequestSignal } from './registerValueListeners.js'
export type { Evidence, ValueDimension, ValueSystem } from './valueSystem.js'
export {
  loadValueSystem,
  reinforceValue,
  weakenValue,
  getValueWeights,
  getTopValues,
  formatValuePreferences,
} from './valueSystem.js'
export type { Intent } from './initiative.js'
export {
  generateDailyIntents,
  loadPendingIntents,
  approveIntent,
  rejectIntent,
  completeIntent,
  saveDailyIntents,
  classifyRisk,
  formatPendingIntents,
} from './initiative.js'
export type { IntentSignal } from './intentMining.js'
export {
  mineIntentSignals,
  loadIntentSignals,
  loadPendingIntentSignals,
  markSignalActed,
} from './intentMining.js'
export type { ActiveThought } from './activeThoughts.js'
export {
  loadActiveThoughts,
  addActiveThought,
  resolveThought,
  referenceThought,
  getTopThoughts,
  formatActiveThoughts,
} from './activeThoughts.js'
