/**
 * Memory system types
 */

export type MemoryCategory = 'pattern' | 'lesson' | 'preference' | 'pitfall' | 'tool'

export type AssociationType = 'keyword' | 'co-task' | 'co-project' | 'semantic'

export interface Association {
  targetId: string
  weight: number // 0-1
  type: AssociationType
}

export interface MemorySource {
  type: 'task' | 'manual' | 'chat'
  taskId?: string
  chatId?: string
  messageId?: string
}

export interface MemoryEntry {
  id: string
  content: string
  category: MemoryCategory
  keywords: string[]
  source: MemorySource
  confidence: number // 0-1
  createdAt: string
  updatedAt: string
  lastAccessedAt?: string // set on retrieval, NOT on content update
  accessCount: number
  projectPath?: string

  // Forgetting engine fields
  strength?: number // 0-100, memory strength
  stability?: number // hours, controls decay speed (higher = slower decay)
  lastReinforcedAt?: string // last meaningful reinforcement time (ISO)
  reinforceCount?: number // times reinforced (different from accessCount)
  decayRate?: number // decay rate factor 0.5-2.0 (higher = faster decay)

  // Association engine fields
  associations?: Association[]
}
