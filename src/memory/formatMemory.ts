/**
 * Format memories for injection into prompts
 */

import { contentSimilarity } from './textSimilarity.js'
import type { MemoryCategory, MemoryEntry } from './types.js'

const CATEGORY_HEADINGS: Record<MemoryCategory, string> = {
  pattern: '### 最佳实践',
  lesson: '### 经验教训',
  pitfall: '### 注意事项',
  preference: '### 偏好设置',
  tool: '### 工具经验',
}

// Per-entry content length limit (chars)
const MAX_ENTRY_LENGTH = 300
// Total injection character budget
const MAX_TOTAL_LENGTH = 3000

/** Truncate content to maxLen, adding ellipsis if needed */
function truncateContent(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content
  return content.slice(0, maxLen - 3) + '...'
}

/** Remove memories with >70% content overlap, keeping higher-scored (earlier in list) */
function deduplicateMemories(memories: MemoryEntry[]): MemoryEntry[] {
  const result: MemoryEntry[] = []
  for (const m of memories) {
    const isDup = result.some(existing => contentSimilarity(existing.content, m.content) > 0.7)
    if (!isDup) result.push(m)
  }
  return result
}

/**
 * Group memories by category and format as markdown.
 * Empty categories are omitted.
 * Deduplicates similar content and applies per-entry and total length limits.
 */
export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return ''

  // Filter out superseded memories, then deduplicate
  memories = memories.filter(m => !m.superseded)
  memories = deduplicateMemories(memories)

  // Group by category
  const groups = new Map<MemoryCategory, MemoryEntry[]>()
  for (const m of memories) {
    const list = groups.get(m.category) ?? []
    list.push(m)
    groups.set(m.category, list)
  }

  const sections: string[] = []
  let totalLength = 0

  // Render in a stable order
  const order: MemoryCategory[] = ['pattern', 'lesson', 'pitfall', 'preference', 'tool']
  for (const cat of order) {
    const entries = groups.get(cat)
    if (!entries || entries.length === 0) continue

    const heading = CATEGORY_HEADINGS[cat]
    const items: string[] = []
    for (const e of entries) {
      const item = `- ${truncateContent(e.content, MAX_ENTRY_LENGTH)}`
      if (totalLength + item.length > MAX_TOTAL_LENGTH) break
      items.push(item)
      totalLength += item.length
    }
    if (items.length > 0) {
      sections.push(`${heading}\n${items.join('\n')}`)
    }
    if (totalLength >= MAX_TOTAL_LENGTH) break
  }

  if (sections.length === 0) return ''

  return sections.join('\n\n')
}
