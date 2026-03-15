/**
 * Detect contradictions between new memory and existing memories
 *
 * Before writing a new memory, checks if it contradicts any existing ones.
 * Uses LLM to determine semantic conflict (same topic, different conclusion).
 */

import { invokeBackend, resolveLightModel } from '../backend/index.js'
import { searchMemories, markSuperseded } from './manageMemory.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { MemoryEntry } from './types.js'

const logger = createLogger('memory-contradiction')

interface ContradictionResult {
  contradicts: boolean
  contradictedIds: string[]
  reason: string
}

/** Find existing memories related to the new content (top 5 by keyword overlap) */
function findRelatedMemories(content: string, keywords: string[]): MemoryEntry[] {
  // Search by content + keywords combined
  const searchQuery = [content, ...keywords].join(' ')
  const results = searchMemories(searchQuery)
  // Filter out already superseded ones
  return results.filter(m => !m.superseded).slice(0, 5)
}

function buildContradictionPrompt(newContent: string, existingMemories: MemoryEntry[]): string {
  const existing = existingMemories
    .map(m => `[ID: ${m.id}] ${m.content}`)
    .join('\n')

  return `判断新记忆是否与现有记忆存在语义冲突（同一事实/主题，不同结论/判断）。

## 新记忆
${newContent}

## 现有记忆
${existing}

## 判断标准
- 矛盾：关于同一件事/同一主题，但结论或判断相反/不同（新信息更新了旧信息）
- 不矛盾：补充信息、不同主题、兼容的描述

## 输出格式
返回 JSON（不要其他内容）：
{"contradicts": true/false, "contradictedIds": ["被矛盾的记忆ID"], "reason": "简要说明"}

如果不矛盾，contradictedIds 为空数组。`
}

/**
 * Check if new memory content contradicts existing memories.
 * If contradictions found, automatically marks old memories as superseded.
 * Returns the IDs of superseded memories (empty if no contradiction).
 */
export async function resolveContradictions(
  newContent: string,
  keywords: string[],
): Promise<string[]> {
  try {
    const related = findRelatedMemories(newContent, keywords)
    if (related.length === 0) return []

    const prompt = buildContradictionPrompt(newContent, related)
    const lightModel = await resolveLightModel()
    const result = await invokeBackend({
      prompt,
      model: lightModel,
      disableMcp: true,
      timeoutMs: 30_000,
    })

    if (!result.ok) {
      logger.warn(`Contradiction detection failed: ${result.error.message}`)
      return []
    }

    const jsonMatch = result.value.response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return []

    let parsed: ContradictionResult
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      logger.warn('Failed to parse contradiction detection result')
      return []
    }

    if (!parsed.contradicts || !Array.isArray(parsed.contradictedIds) || parsed.contradictedIds.length === 0) {
      return []
    }

    // Validate IDs exist in our related set
    const relatedIds = new Set(related.map(m => m.id))
    const validIds = parsed.contradictedIds.filter(id => relatedIds.has(id))

    // Mark contradicted memories as superseded
    for (const id of validIds) {
      markSuperseded(id)
      logger.info(`Superseded memory ${id}: ${parsed.reason}`)
    }

    return validIds
  } catch (error) {
    logger.warn(`Contradiction resolution error: ${getErrorMessage(error)}`)
    return []
  }
}
