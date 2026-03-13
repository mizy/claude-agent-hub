/**
 * Memory system types
 */

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

// ============ Episodic Memory Types ============

export type EpisodeTone = 'technical' | 'casual' | 'urgent' | 'exploratory'
export type EpisodePlatform = 'lark' | 'telegram' | 'cli'

export type EmotionalPolarity = 'positive' | 'negative' | 'neutral'

export type EmotionalTrigger =
  | 'task_success'
  | 'task_failure'
  | 'user_praise'
  | 'user_frustration'
  | 'error_recovery'
  | 'creative_solution'
  | 'learning_moment'
  | 'collaboration'
  | 'breakthrough'
  | 'confusion'
  | string // extensible

export interface EmotionalValence {
  polarity: EmotionalPolarity
  intensity: number // 0-1, 0 = neutral/none, 1 = strongest
  triggers: EmotionalTrigger[]
}

export interface Episode {
  id: string // episode-{timestamp}-{hash}
  timestamp: string // ISO string
  participants: string[] // [userId, agentId]
  conversationId?: string // 飞书/Telegram chat_id
  turnCount: number
  summary: string // AI generated conversation summary
  keyDecisions: string[] // key decision points
  tone: EpisodeTone
  relatedMemories: string[] // associated semantic memory IDs
  previousEpisode?: string // previous related episode ID
  platform: EpisodePlatform
  triggerKeywords: string[] // trigger keywords for retrieval
  valence?: EmotionalValence // emotional coloring of the episode
}

export interface EpisodeIndexEntry {
  id: string
  timestamp: string
  triggerKeywords: string[]
  summary: string // truncated summary for quick lookup
  platform: EpisodePlatform
  valence?: EmotionalValence // carried to index for emotion-aware retrieval
}

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
