export interface PromptVersion {
  id: string // "pv-{timestamp}-{random}"
  personaName: string // "Pragmatist", "Architect" etc.
  parentVersionId?: string // parent version ID (undefined for first version)
  version: number // incremental version number (1, 2, 3...)

  // Prompt content
  systemPrompt: string // full persona systemPrompt
  changelog: string // change description (AI generated)

  // Aggregated stats
  stats: PromptVersionStats

  // Metadata
  status: PromptVersionStatus // active=current, candidate=pending validation, retired=deprecated
  createdAt: string // ISO timestamp
}

export type PromptVersionStatus = 'active' | 'candidate' | 'retired'

export interface PromptVersionStats {
  totalTasks: number
  successCount: number
  failureCount: number
  successRate: number // 0-1
  avgDurationMs: number
  lastUsedAt?: string
}

export interface FailureAnalysis {
  taskId: string
  personaName: string
  versionId: string // prompt version used
  failedNodes: FailedNodeInfo[]
  rootCause: string // AI analyzed root cause
  suggestion: string // AI improvement suggestion
  analyzedAt: string
}

export interface FailedNodeInfo {
  nodeId: string
  nodeName: string
  error: string
  attempts: number
}
