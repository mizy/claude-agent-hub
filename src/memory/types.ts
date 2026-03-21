/**
 * Memory system types
 */

import type { EmotionalValence } from '../types/episode.js'

export type MemoryCategory = 'pattern' | 'lesson' | 'preference' | 'pitfall' | 'tool'

export type MemoryTier = 'hot' | 'longterm' | 'permanent'

export type AssociationType = 'keyword' | 'co-task' | 'co-project' | 'semantic' | 'temporal'

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

  // Importance & supersession fields
  importance?: number // 1-10, how valuable this memory is
  superseded?: boolean // true if replaced by a newer memory
  supersedesId?: string // id of the older memory this one replaces

  // Structured tags for categorized retrieval
  tags?: string[]

  // Tier field for memory layering
  tier?: MemoryTier

  // Emotional valence (optional, for emotion-aware scoring)
  valence?: EmotionalValence

  // Association engine fields
  associations?: Association[]
}

// ============ Episodic Memory Types (re-exported from types/episode.ts) ============

export type {
  EpisodeTone,
  EpisodePlatform,
  EmotionalPolarity,
  EmotionalTrigger,
  EmotionalValence,
  Episode,
  EpisodeIndexEntry,
} from '../types/episode.js'

// ============ Atomic Facts (EverMemOS-inspired) ============

export interface AtomicFact {
  id: string
  fact: string
  confidence: number // 0-1
  validUntil?: string // ISO time, auto-skip when expired
  domain: string // "fund" / "health" / "work" / "code"
  source: 'chat' | 'task' | 'manual'
  createdAt: string
  accessCount: number
  tier: MemoryTier
}

// ============ MemScene User Model Snapshot ============

export interface MemScene {
  domain: string
  summary: string
  factIds: string[]
  memoryIds: string[]
  episodeIds: string[]
  updatedAt: string
}

// ============ Foresight Predictions ============

export interface Foresight {
  id: string
  prediction: string
  validUntil: string // ISO time
  domain: string
  confidence: number // 0-1
  createdAt: string
}
