/**
 * Extract episodic memory from conversations
 *
 * Analyzes chat messages via AI to generate episode summaries,
 * key decisions, tone classification, and trigger keywords.
 * Non-blocking — runs asynchronously without affecting chat flow.
 */

import { invokeBackend } from '../backend/index.js'
import { generateShortId } from '../shared/generateId.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { saveEpisode, searchEpisodes } from '../store/EpisodeStore.js'
import type { Episode, EpisodeTone, EpisodePlatform } from './types.js'

const logger = createLogger('episodic-memory')

const VALID_TONES: EpisodeTone[] = ['technical', 'casual', 'urgent', 'exploratory']

export interface EpisodeMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ExtractEpisodeParams {
  messages: EpisodeMessage[]
  platform: EpisodePlatform
  conversationId?: string
  participants?: string[]
  relatedMemoryIds?: string[]
}

function buildEpisodePrompt(messages: EpisodeMessage[]): string {
  const conversation = messages
    .map(m => `[${m.role === 'user' ? '用户' : 'AI'}] ${m.content}`)
    .join('\n\n')

  return `你是一位对话分析专家。请从以下对话中提取情景记忆摘要。

## 对话内容
${conversation}

## 提取要求
请分析对话并提取以下信息：

1. **summary**: 对话摘要（3-5句话，概括讨论主题和结论，不要包含完整对话内容）
2. **keyDecisions**: 对话中做出的关键决策点（字符串数组，如果没有则为空数组）
3. **tone**: 对话基调，只能是以下之一: "technical" | "casual" | "urgent" | "exploratory"
4. **triggerKeywords**: 触发关键词（5-10个，用于后续检索此对话）

## 输出格式
只返回 JSON 对象，不要其他内容：
{
  "summary": "...",
  "keyDecisions": ["...", "..."],
  "tone": "technical",
  "triggerKeywords": ["...", "..."]
}`
}

interface RawEpisodeExtraction {
  summary: string
  keyDecisions: string[]
  tone: string
  triggerKeywords: string[]
}

function parseExtraction(text: string): RawEpisodeExtraction | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (typeof parsed.summary !== 'string' || !parsed.summary) return null
    return parsed
  } catch (e) {
    logger.debug(`Episode JSON parse failed: ${getErrorMessage(e)}`)
    return null
  }
}

function generateEpisodeId(): string {
  const ts = Date.now()
  const hash = generateShortId().slice(0, 6)
  return `episode-${ts}-${hash}`
}

function findPreviousEpisode(
  conversationId?: string,
  keywords?: string[],
): string | undefined {
  // Search by keyword overlap (index doesn't store conversationId directly)
  if (keywords && keywords.length > 0) {
    for (const kw of keywords) {
      const matches = searchEpisodes(kw)
      if (matches.length > 0 && matches[0]) {
        return matches[0].id // newest first (index sorted by timestamp desc)
      }
    }
  }

  return undefined
}

/**
 * Extract an episodic memory from a conversation.
 * Returns the saved Episode, or null on failure.
 */
export async function extractEpisode(params: ExtractEpisodeParams): Promise<Episode | null> {
  const { messages, platform, conversationId, participants = [], relatedMemoryIds = [] } = params

  if (messages.length < 2) return null

  try {
    const prompt = buildEpisodePrompt(messages)

    const result = await invokeBackend({
      prompt,
      mode: 'review',
      disableMcp: true,
      timeoutMs: 30_000,
    })

    if (!result.ok) {
      logger.warn(`Episode extraction failed: ${result.error.message}`)
      return null
    }

    const extraction = parseExtraction(result.value.response)
    if (!extraction) {
      logger.warn(`Failed to parse episode extraction result. Raw response (first 500 chars): ${result.value.response.slice(0, 500)}`)
      return null
    }

    // Validate tone
    const tone: EpisodeTone = VALID_TONES.includes(extraction.tone as EpisodeTone)
      ? (extraction.tone as EpisodeTone)
      : 'technical'

    const triggerKeywords = Array.isArray(extraction.triggerKeywords)
      ? extraction.triggerKeywords.filter((k): k is string => typeof k === 'string')
      : []

    const keyDecisions = Array.isArray(extraction.keyDecisions)
      ? extraction.keyDecisions.filter((d): d is string => typeof d === 'string')
      : []

    // Find previous related episode
    const previousEpisode = findPreviousEpisode(conversationId, triggerKeywords)

    const episode: Episode = {
      id: generateEpisodeId(),
      timestamp: new Date().toISOString(),
      participants,
      conversationId,
      turnCount: messages.length,
      summary: extraction.summary,
      keyDecisions,
      tone,
      relatedMemories: relatedMemoryIds,
      previousEpisode,
      platform,
      triggerKeywords,
    }

    saveEpisode(episode)
    logger.info(`Extracted episode ${episode.id} (${platform}, ${messages.length} turns)`)
    return episode
  } catch (error) {
    logger.warn(`Episode extraction error: ${getErrorMessage(error)}`)
    return null
  }
}
