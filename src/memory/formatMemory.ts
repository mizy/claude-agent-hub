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

/**
 * Group memories by category and format as markdown.
 * Empty categories are omitted.
 */
export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return ''

  // Group by category
  const groups = new Map<MemoryCategory, MemoryEntry[]>()
  for (const m of memories) {
    const list = groups.get(m.category) ?? []
    list.push(m)
    groups.set(m.category, list)
  }

  const sections: string[] = []

  // Render in a stable order
  const order: MemoryCategory[] = ['pattern', 'lesson', 'pitfall', 'preference', 'tool']
  for (const cat of order) {
    const entries = groups.get(cat)
    if (!entries || entries.length === 0) continue

    const heading = CATEGORY_HEADINGS[cat]
    const items = entries.map(e => `- ${e.content}`).join('\n')
    sections.push(`${heading}\n${items}`)
  }

  if (sections.length === 0) return ''

  return `## 记忆上下文\n\n${sections.join('\n\n')}`
}
