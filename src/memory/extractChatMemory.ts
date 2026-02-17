/**
 * Extract memories from chat conversations
 *
 * Analyzes chat messages via AI to identify worth-remembering information:
 * technical decisions, user preferences, important conclusions, error fixes.
 * Non-blocking — runs asynchronously without affecting chat flow.
 */

import { invokeBackend } from '../backend/index.js'
import { addMemory } from './manageMemory.js'
import { buildAssociations } from './associationEngine.js'
import { getAllMemories } from '../store/MemoryStore.js'
import { migrateMemoryEntry } from './migrateMemory.js'
import { saveMemory } from '../store/MemoryStore.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { MemoryCategory, MemoryEntry } from './types.js'

const logger = createLogger('chat-memory')

const MAX_MEMORIES_PER_CHAT = 3
const VALID_CATEGORIES: MemoryCategory[] = ['pattern', 'lesson', 'preference', 'pitfall', 'tool']

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

interface ChatMemoryContext {
  chatId: string
  platform?: string
}

function buildChatMemoryPrompt(messages: ChatMessage[]): string {
  const conversation = messages
    .map(m => `[${m.role === 'user' ? '用户' : 'AI'}] ${m.text}`)
    .join('\n\n')

  return `你是一位经验丰富的开发者。请从以下对话中提取值得长期记忆的信息。

## 对话内容
${conversation}

## 提取标准
只提取以下类型的信息：
1. **用户明确要求记住的**：「记住这个」「以后注意」「下次别忘了」
2. **技术决策**：技术选型、架构决定、项目约定
3. **用户偏好**：工作方式、工具选择、编码风格
4. **纠错信息**：用户纠正了 AI 的错误回答
5. **重要结论**：经过讨论得出的重要技术结论

**不提取**：闲聊内容、一次性查询、临时问题

## 输出格式
以 JSON 数组格式返回，每条包含：
- content: 记忆内容（简洁明了，1-2 句话）
- category: 分类，只能是 "pattern" | "lesson" | "preference" | "pitfall" | "tool"
- keywords: 关键词数组（3-5 个）
- confidence: 置信度 0-1

如果没有值得记录的信息，返回空数组 \`[]\`。
只返回 JSON，不要其他内容。`
}

interface RawExtraction {
  content: string
  category: string
  keywords: string[]
  confidence: number
}

function parseExtractions(text: string): RawExtraction[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function isValidExtraction(item: RawExtraction): boolean {
  return (
    typeof item.content === 'string' &&
    item.content.length > 0 &&
    VALID_CATEGORIES.includes(item.category as MemoryCategory) &&
    Array.isArray(item.keywords) &&
    typeof item.confidence === 'number' &&
    item.confidence >= 0 &&
    item.confidence <= 1
  )
}

/**
 * Extract memories from a chat conversation.
 * Returns extracted entries (already saved).
 */
export async function extractChatMemory(
  messages: ChatMessage[],
  context: ChatMemoryContext,
): Promise<MemoryEntry[]> {
  if (messages.length < 2) return []

  try {
    const prompt = buildChatMemoryPrompt(messages)

    const result = await invokeBackend({
      prompt,
      mode: 'review',
      disableMcp: true,
      timeoutMs: 30_000,
    })

    if (!result.ok) {
      logger.warn(`Chat memory extraction failed: ${result.error.message}`)
      return []
    }

    const extractions = parseExtractions(result.value.response)
    if (extractions.length === 0) return []

    const entries: MemoryEntry[] = []

    for (const item of extractions.slice(0, MAX_MEMORIES_PER_CHAT)) {
      if (!isValidExtraction(item)) continue

      const entry = addMemory(item.content, item.category as MemoryCategory, {
        type: 'chat',
        chatId: context.chatId,
      }, {
        keywords: item.keywords,
        confidence: item.confidence,
      })

      entries.push(entry)
    }

    // Build associations for new entries
    if (entries.length > 0) {
      const allEntries = getAllMemories().map(migrateMemoryEntry)
      for (const entry of entries) {
        const migrated = migrateMemoryEntry(entry)
        migrated.associations = await buildAssociations(migrated, allEntries)
        saveMemory(migrated)
      }
    }

    logger.info(`Extracted ${entries.length} memories from chat [${context.chatId.slice(0, 8)}]`)
    return entries
  } catch (error) {
    logger.warn(`Chat memory extraction error: ${getErrorMessage(error)}`)
    return []
  }
}
