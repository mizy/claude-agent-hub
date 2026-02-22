/**
 * @entry Self-Evolution 模块
 *
 * Analyzes task failures, generates improvements, and tracks evolution history.
 * Integrates with prompt-optimization for prompt-level improvements.
 *
 * Main API:
 * - analyzeRecentFailures(): Scan failed tasks and extract patterns
 * - applyImprovements(): Apply improvement proposals via prompt-optimization
 * - validateEvolution(): Check if an evolution cycle improved outcomes
 * - runEvolutionCycle(): Orchestrate full analyze → review → improve → record cycle
 * - reviewImprovement/reviewImprovements(): Agent review for improvement proposals
 * - recordEvolution/listEvolutions(): Evolution history CRUD
 */

// ============ Types ============

export type {
  ImprovementSource,
  FailurePattern,
  Improvement,
  ApplyResult,
  EvolutionStatus,
  EvolutionRecord,
  EvolutionValidation,
  PerformanceMetrics,
  PerformancePattern,
  PerformanceAnalysis,
  ReviewResult,
} from './types.js'

// ============ Task Pattern Analysis ============

export { analyzeTaskPatterns, analyzeRecentFailures } from './analyzeTaskPatterns.js'
export type { TaskAnalysisResult } from './analyzeTaskPatterns.js'

// ============ Performance Analysis ============

export { analyzePerformance } from './analyzePerformance.js'

// ============ Review ============

export { reviewImprovement, reviewImprovements } from './reviewImprovement.js'

// ============ Apply Improvements ============

export { applyImprovements } from './applyImprovements.js'

// ============ Validation ============

export { validateEvolution } from './validateEvolution.js'

// ============ Evolution History ============

export {
  generateEvolutionId,
  recordEvolution,
  getEvolution,
  updateEvolution,
  listEvolutions,
  getLatestEvolution,
} from './evolutionHistory.js'

// ============ Signal Detection ============

export {
  detectSignals,
  resetSignalCooldowns,
} from './signalDetector.js'
export type {
  SignalType,
  SignalSeverity,
  SignalEvent,
  DetectSignalOptions,
} from './signalDetector.js'

// ============ Orchestration ============

export { runEvolutionCycle } from './runEvolution.js'
