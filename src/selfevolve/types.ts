/**
 * Self-evolution types
 *
 * Defines the data structures for tracking evolution cycles,
 * improvement records, and validation results.
 */

// ============ Failure Analysis ============

export type ImprovementSource = 'prompt' | 'workflow' | 'environment' | 'resource'

export interface FailurePattern {
  category: ImprovementSource
  description: string
  occurrences: number
  taskIds: string[]
  sampleErrors: string[]
}

// ============ Performance Analysis ============

/** Single task performance metrics (extracted from stats.json) */
export interface PerformanceMetrics {
  taskId: string
  status: 'completed' | 'failed'
  totalDurationMs: number
  totalCostUsd: number
  nodeCount: number
  avgNodeDurationMs: number
  maxNodeDurationMs: number
  maxNodeName: string
  retryCount: number
  failedNodeCount: number
}

/** Performance pattern detected from multiple tasks */
export interface PerformancePattern {
  category: 'slow_execution' | 'high_cost' | 'excessive_retries' | 'bottleneck_node'
  description: string
  severity: 'info' | 'warning' | 'critical'
  metric: string
  value: number
  threshold: number
  taskIds: string[]
  suggestion: string
}

/** Aggregated performance analysis result */
export interface PerformanceAnalysis {
  totalExamined: number
  avgDurationMs: number
  avgCostUsd: number
  successRate: number
  patterns: PerformancePattern[]
  nodeHotspots: Array<{
    nodeName: string
    avgDurationMs: number
    occurrences: number
  }>
}

// ============ Review ============

/** Agent review result for an improvement proposal */
export interface ReviewResult {
  approved: boolean
  confidence: number
  reasoning: string
  suggestions?: string[]
  risksIdentified?: string[]
}

// ============ Improvements ============

export interface Improvement {
  id: string
  source: ImprovementSource
  description: string
  /** Which persona is affected (for prompt improvements) */
  personaName?: string
  /** Concrete change applied */
  detail: string
  /** The failure pattern that triggered this improvement */
  triggeredBy: string
}

export interface ApplyResult {
  improvementId: string
  applied: boolean
  message: string
}

// ============ Evolution Record ============

export type EvolutionStatus = 'running' | 'completed' | 'failed'

export interface EvolutionRecord {
  id: string
  status: EvolutionStatus
  startedAt: string
  completedAt?: string
  /** What triggered this evolution (manual, scheduled, threshold, signal) */
  trigger: 'manual' | 'scheduled' | 'threshold' | 'signal'
  /** Failure patterns found during analysis */
  patterns: FailurePattern[]
  /** Improvements applied */
  improvements: Improvement[]
  /** Validation results */
  validation?: EvolutionValidation
  /** Error message if evolution failed */
  error?: string
  /** Performance analysis results (optional, backward compatible) */
  performanceAnalysis?: PerformanceAnalysis
  /** Review results for each improvement (optional, backward compatible) */
  reviewResults?: Array<{
    improvementId: string
    review: ReviewResult
  }>
  /** Signal that triggered this evolution (when trigger === 'signal') */
  signalContext?: {
    type: string
    pattern: string
    severity: string
    taskIds: string[]
  }
}

// ============ Validation ============

export interface EvolutionValidation {
  /** Task success rate before evolution */
  baselineSuccessRate: number
  /** Task success rate after evolution (from recent tasks) */
  currentSuccessRate: number
  /** Number of tasks evaluated */
  sampleSize: number
  /** Whether the evolution is considered beneficial */
  improved: boolean
  /** Summary of findings */
  summary: string
  /** Performance trend comparison (optional, backward compatible) */
  performanceTrend?: {
    avgDurationBefore: number
    avgDurationAfter: number
    avgCostBefore: number
    avgCostAfter: number
    durationImproved: boolean
    costImproved: boolean
  }
}
