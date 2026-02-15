/**
 * Memory management — add, list, remove, search
 */

import { generateShortId } from '../shared/generateId.js'
import { extractKeywords } from '../analysis/index.js'
import {
  getAllMemories,
  saveMemory,
  deleteMemory as deleteMemoryFromStore,
} from '../store/MemoryStore.js'
import type { MemoryCategory, MemoryEntry, MemorySource } from './types.js'

interface AddMemoryOptions {
  keywords?: string[]
  confidence?: number
  projectPath?: string
}

export function addMemory(
  content: string,
  category: MemoryCategory,
  source: MemorySource,
  options?: AddMemoryOptions,
): MemoryEntry {
  const now = new Date().toISOString()
  const keywords = options?.keywords ?? extractKeywords(content)

  const entry: MemoryEntry = {
    id: generateShortId(),
    content,
    category,
    keywords,
    source,
    confidence: options?.confidence ?? 0.5,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    projectPath: options?.projectPath,
  }

  saveMemory(entry)
  return entry
}

interface ListMemoriesFilter {
  category?: MemoryCategory
  projectPath?: string
}

export function listMemories(filter?: ListMemoriesFilter): MemoryEntry[] {
  const all = getAllMemories()
  if (!filter) return all

  return all.filter(entry => {
    if (filter.category && entry.category !== filter.category) return false
    if (filter.projectPath && entry.projectPath !== filter.projectPath) return false
    return true
  })
}

export function removeMemory(id: string): boolean {
  return deleteMemoryFromStore(id)
}

export function searchMemories(query: string): MemoryEntry[] {
  const queryKeywords = extractKeywords(query)
  if (queryKeywords.length === 0) return []

  const all = getAllMemories()
  return all.filter(entry => {
    // Match if any query keyword appears in entry keywords or content
    return queryKeywords.some(
      qk => entry.keywords.some(ek => ek.includes(qk) || qk.includes(ek)) ||
        entry.content.toLowerCase().includes(qk),
    )
  })
}
