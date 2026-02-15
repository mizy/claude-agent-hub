/**
 * Memory system types
 */

export type MemoryCategory = 'pattern' | 'lesson' | 'preference' | 'pitfall' | 'tool'

export interface MemorySource {
  type: 'task' | 'manual' | 'chat'
  taskId?: string
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
}
