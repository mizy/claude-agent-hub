/**
 * Format memories for injection into prompts
 */

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

/** CJK character range test */
function isCJK(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)
}

/** Tokenize text into words (space-split for Latin) + 2-gram for CJK */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
  const lower = text.toLowerCase()

  // Extract space-separated words (Latin, numbers, mixed)
  for (const w of lower.split(/\s+/)) {
    if (w.length >= 2) tokens.add(w)
  }

  // Extract CJK 2-grams
  for (let i = 0; i < lower.length - 1; i++) {
    if (isCJK(lower[i]!) && isCJK(lower[i + 1]!)) {
      tokens.add(lower[i]! + lower[i + 1]!)
    }
  }

  return tokens
}

/** Word-set + CJK n-gram overlap ratio for dedup */
function contentSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a)
  const tokensB = tokenize(b)
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let overlap = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++
  }
  return overlap / Math.max(tokensA.size, tokensB.size)
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
