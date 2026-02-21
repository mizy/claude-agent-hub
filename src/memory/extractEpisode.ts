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

1. **summary**: 对话摘要（3-5句话）。必须包含：讨论了什么问题、尝试了什么方案、最终结论或结果。避免泛泛描述，要有具体的技术细节。
2. **keyDecisions**: 对话中做出的关键决策（字符串数组）。每个决策要写清楚"选择了X而非Y，因为Z"的形式。如果没有决策则为空数组。
3. **tone**: 对话基调，只能是以下之一: "technical" | "casual" | "urgent" | "exploratory"
4. **triggerKeywords**: 触发关键词（5-10个，用于后续检索此对话）。包含具体的技术术语、工具名、模块名等，不要用"讨论"、"修复"等泛词。

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
  // Try to find the last complete JSON object (greedy regex may grab too much)
  // First try: extract between first { and last }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  const jsonStr = text.slice(start, end + 1)
  try {
    const parsed = JSON.parse(jsonStr)
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

/** Check if a recent episode with similar content already exists (dedup) */
function isDuplicateEpisode(keywords: string[]): boolean {
  if (keywords.length === 0) return false
  // Check if any recent episode has high keyword overlap
  for (const kw of keywords.slice(0, 3)) {
    const matches = searchEpisodes(kw)
    for (const match of matches) {
      const matchKeywords = new Set(match.triggerKeywords.map(k => k.toLowerCase()))
      const overlapCount = keywords.filter(k => matchKeywords.has(k.toLowerCase())).length
      const overlapRatio = overlapCount / Math.max(keywords.length, matchKeywords.size)
      // If >70% keyword overlap with a recent episode (<1h), treat as duplicate
      if (overlapRatio > 0.7) {
        const age = Date.now() - new Date(match.timestamp).getTime()
        if (age < 60 * 60 * 1000) {
          logger.debug(`Skipping duplicate episode (overlap=${overlapRatio.toFixed(2)} with ${match.id})`)
          return true
        }
      }
    }
  }
  return false
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

    // Dedup: skip if a very similar episode was recently created
    if (isDuplicateEpisode(triggerKeywords)) {
      return null
    }

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
