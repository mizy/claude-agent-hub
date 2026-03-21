/**
 * Episodic memory types and emotional valence types
 *
 * Moved from memory/types.ts to break types → memory reverse dependency
 */

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
