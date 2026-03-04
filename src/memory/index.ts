/**
 * @entry Memory 记忆模块
 *
 * 提供记忆存储、检索和格式化能力，让 AI Agent 能从历史经验中学习
 *
 * 主要 API:
 * - CRUD: addMemory / listMemories / removeMemory / searchMemories
 * - 检索: retrieveRelevantMemories / retrieveAllMemoryContext
 * - 情景记忆: retrieveEpisodes / shouldRetrieveEpisode / formatEpisodeContext / extractEpisode
 * - 格式化: formatMemoriesForPrompt
 * - 提取: extractMemoryFromTask（从任务学习）/ extractChatMemory（从对话学习）
 * - 迁移: migrateMemoryEntry / needsMigration
 * - 遗忘引擎: calculateStrength / reinforceMemory / cleanupFadingMemories / getMemoryHealth
 * - 关联引擎: buildAssociations / spreadActivation / updateAssociationStrength
 *   associativeRetrieve / rebuildAllAssociations
 */

// Types
export type { MemoryCategory, MemoryEntry, MemorySource, Association, AssociationType, Episode, EpisodeTone, EpisodePlatform, EpisodeIndexEntry } from './types.js'

// Management — CRUD and search
export { addMemory, listMemories, removeMemory, searchMemories } from './manageMemory.js'

// Retrieval — scored ranking
export { retrieveRelevantMemories, retrieveAllMemoryContext } from './retrieveMemory.js'

// Episodic memory — retrieval and injection
export { retrieveEpisodes } from './retrieveEpisode.js'
export { shouldRetrieveEpisode, formatEpisodeContext } from './injectEpisode.js'

// Formatting — prompt injection
export { formatMemoriesForPrompt } from './formatMemory.js'

// Extraction — learn from task execution
export { extractMemoryFromTask } from './extractMemory.js'

// Extraction — learn from chat conversations
export { extractChatMemory } from './extractChatMemory.js'
export type { ChatMessage } from './extractChatMemory.js'

// Migration — lazy upgrade for legacy entries
export { migrateMemoryEntry, needsMigration } from './migrateMemory.js'

// Forgetting engine — strength decay, reinforcement, cleanup
export {
  calculateStrength,
  reinforceMemory,
  cleanupFadingMemories,
  getMemoryHealth,
} from './forgettingEngine.js'

// Extraction — episodic memory from conversations
export { extractEpisode } from './extractEpisode.js'
export type { EpisodeMessage, ExtractEpisodeParams } from './extractEpisode.js'

// Association engine — build, spread, retrieve via associations
export {
  buildAssociations,
  spreadActivation,
  updateAssociationStrength,
  associativeRetrieve,
  rebuildAllAssociations,
} from './associationEngine.js'
