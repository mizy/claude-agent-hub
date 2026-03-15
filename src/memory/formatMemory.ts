/**
 * Format memories for injection into prompts
 */

import { contentSimilarity } from './textSimilarity.js'
import { getAtomicFact } from '../store/AtomicFactStore.js'
import type { MemScene, MemoryCategory, MemoryEntry } from './types.js'

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
 * Format MemScene snapshots in layered format:
 * Layer1: domain overview (~200 chars)
 * Layer2: atomic facts from linked factIds (~500 chars)
 */
export function formatMemSceneSection(scenes: MemScene[]): string {
  if (scenes.length === 0) return ''

  // Layer1: compact domain summaries
  const domainParts = scenes.map(s => {
    const counts: string[] = []
    if (s.factIds.length > 0) counts.push(`${s.factIds.length}条事实`)
    if (s.memoryIds.length > 0) counts.push(`${s.memoryIds.length}条记忆`)
    return `${s.domain}(${counts.join(',')})`
  })
  const layer1 = `[用户快照] ${domainParts.join(' ')}`

  // Layer2: collect atomic facts from all scenes
  const factTexts: string[] = []
  let factLen = 0
  const FACT_BUDGET = 500
  for (const s of scenes) {
    for (const fid of s.factIds) {
      if (factLen >= FACT_BUDGET) break
      const af = getAtomicFact(fid)
      if (!af) continue
      const text = af.fact.length > 80 ? af.fact.slice(0, 77) + '...' : af.fact
      factTexts.push(text)
      factLen += text.length + 2
    }
  }

  if (factTexts.length === 0) return layer1
  return `${layer1}\n[原子事实] ${factTexts.join('; ')}`
}

/**
 * Group memories by category and format as markdown.
 * Empty categories are omitted.
 * Deduplicates similar content and applies per-entry and total length limits.
 */
export function formatMemoriesForPrompt(memories: MemoryEntry[], memScenes?: MemScene[]): string {
  const parts: string[] = []

  // Layer 1: MemScene user profile snapshot
  if (memScenes && memScenes.length > 0) {
    parts.push(formatMemSceneSection(memScenes))
  }

  if (memories.length === 0) return parts.join('\n\n')

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
      const suffix = e.confidence < 0.5 ? ' (模糊)' : ''
      const item = `- ${truncateContent(e.content, MAX_ENTRY_LENGTH)}${suffix}`
      if (totalLength + item.length > MAX_TOTAL_LENGTH) break
      items.push(item)
      totalLength += item.length
    }
    if (items.length > 0) {
      sections.push(`${heading}\n${items.join('\n')}`)
    }
    if (totalLength >= MAX_TOTAL_LENGTH) break
  }

  if (sections.length === 0) return parts.join('\n\n')

  parts.push(sections.join('\n\n'))
  return parts.join('\n\n')
}
