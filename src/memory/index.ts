/**
 * @entry Memory 记忆模块
 *
 * 提供记忆存储、检索和格式化能力，让 AI Agent 能从历史经验中学习
 *
 * 主要 API:
 * - addMemory(): 添加记忆
 * - listMemories(): 列出记忆
 * - removeMemory(): 删除记忆
 * - searchMemories(): 关键词搜索
 * - retrieveRelevantMemories(): 智能检索相关记忆
 * - formatMemoriesForPrompt(): 格式化为 prompt 注入
 * - migrateMemoryEntry(): 懒加载迁移旧格式记忆
 * - calculateStrength(): 计算记忆当前强度
 * - reinforceMemory(): 强化记忆
 * - cleanupFadingMemories(): 清理衰减记忆
 * - getMemoryHealth(): 查看记忆健康状态
 */

// Types
export type { MemoryCategory, MemoryEntry, MemorySource, Association, AssociationType } from './types.js'

// Management — CRUD and search
export { addMemory, listMemories, removeMemory, searchMemories } from './manageMemory.js'

// Retrieval — scored ranking
export { retrieveRelevantMemories } from './retrieveMemory.js'

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

// Association engine — build, spread, retrieve via associations
export {
  buildAssociations,
  spreadActivation,
  updateAssociationStrength,
  associativeRetrieve,
  rebuildAllAssociations,
} from './associationEngine.js'
