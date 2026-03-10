/**
 * Generate conversation summary for consciousness stream
 *
 * Short conversations: extract last user message directly
 * Longer conversations: call haiku via invokeBackend
 * All failures degrade gracefully — never throws
 */

import { invokeBackend, resolveLightModel } from '../backend/index.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('consciousness:summary')

const MAX_SUMMARY_LENGTH = 200
const SHORT_CONVERSATION_THRESHOLD = 3

export interface ConversationMessage {
  role: 'user' | 'assistant'
  text: string
}

/** Structured session-end consciousness data */
export interface SessionEndInsight {
  summary: string
  emotionalShift: string
  unfinishedThoughts: string[]
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}

function getLastUserMessage(messages: ConversationMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user' && messages[i]!.text.trim()) {
      return messages[i]!.text.trim()
    }
  }
  return ''
}

/**
 * Generate a conversation summary.
 *
 * - <3 user messages: return last user message directly (no LLM call)
 * - Otherwise: call haiku to summarize
 * - On failure: fallback to last user message (first 100 chars)
 */
export async function generateConversationSummary(
  messages: ConversationMessage[],
): Promise<string> {
  const userMessages = messages.filter(m => m.role === 'user')
  const lastUserText = getLastUserMessage(messages)

  if (!lastUserText) return ''

  // Short conversation — no LLM needed
  if (userMessages.length < SHORT_CONVERSATION_THRESHOLD) {
    return truncate(lastUserText, MAX_SUMMARY_LENGTH)
  }

  // Build conversation text for haiku
  try {
    // Truncate to last ~3000 chars to avoid huge prompts for long conversations
    const MAX_CONTEXT_CHARS = 3000
    let conversationText = messages
      .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.text}`)
      .join('\n')
    if (conversationText.length > MAX_CONTEXT_CHARS) {
      conversationText = '…(earlier messages omitted)\n' + conversationText.slice(-MAX_CONTEXT_CHARS)
    }

    const prompt = `将以下对话总结为1-2句话（中文，≤100字），描述主要话题和结论：

${conversationText}`

    const lightModel = await resolveLightModel()
    const result = await invokeBackend({
      prompt,
      mode: 'review',
      model: lightModel,
      disableMcp: true,
      timeoutMs: 30_000,
    })

    if (result.ok && result.value.response.trim()) {
      return truncate(result.value.response.trim(), MAX_SUMMARY_LENGTH)
    }

    logger.warn('Summary generation returned empty or failed, using fallback')
  } catch (error) {
    logger.warn(`Summary generation failed: ${getErrorMessage(error)}`)
  }

  // Fallback: first 100 chars of last user message
  return truncate(lastUserText, 100)
}

/**
 * Generate structured session-end insight with emotional shift and unfinished thoughts.
 * Short conversations: simple extraction without LLM.
 * Longer conversations: call haiku for structured analysis.
 */
export async function generateSessionEndInsight(
  messages: ConversationMessage[],
): Promise<SessionEndInsight> {
  const userMessages = messages.filter(m => m.role === 'user')
  const lastUserText = getLastUserMessage(messages)

  if (!lastUserText) {
    return { summary: '', emotionalShift: 'neutral→neutral', unfinishedThoughts: [] }
  }

  // Short conversation — no LLM needed
  if (userMessages.length < SHORT_CONVERSATION_THRESHOLD) {
    return {
      summary: truncate(lastUserText, MAX_SUMMARY_LENGTH),
      emotionalShift: 'neutral→neutral',
      unfinishedThoughts: [],
    }
  }

  try {
    const MAX_CONTEXT_CHARS = 3000
    let conversationText = messages
      .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.text}`)
      .join('\n')
    if (conversationText.length > MAX_CONTEXT_CHARS) {
      conversationText = '…(earlier messages omitted)\n' + conversationText.slice(-MAX_CONTEXT_CHARS)
    }

    const prompt = `分析以下对话，返回 JSON（不要 markdown 包裹）：
{
  "summary": "1-2句话总结主要话题和结论（中文，≤100字）",
  "emotionalShift": "对话情绪变化，格式：起始→结束，如 neutral→engaged, curious→satisfied",
  "unfinishedThoughts": ["未完成的想法或待办事项，最多3条"]
}

${conversationText}`

    const lightModel = await resolveLightModel()
    const result = await invokeBackend({
      prompt,
      mode: 'review',
      model: lightModel,
      disableMcp: true,
      timeoutMs: 30_000,
    })

    if (result.ok && result.value.response.trim()) {
      try {
        let raw = result.value.response.trim()
        // Strip markdown code fence if LLM wraps JSON in ```json ... ```
        const fenceMatch = raw.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
        if (fenceMatch) raw = fenceMatch[1]!.trim()
        const parsed = JSON.parse(raw) as Record<string, unknown>
        return {
          summary: truncate(
            typeof parsed.summary === 'string' ? parsed.summary || lastUserText : lastUserText,
            MAX_SUMMARY_LENGTH,
          ),
          emotionalShift:
            typeof parsed.emotionalShift === 'string' ? parsed.emotionalShift : 'neutral→neutral',
          unfinishedThoughts: Array.isArray(parsed.unfinishedThoughts)
            ? (parsed.unfinishedThoughts as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 3)
            : [],
        }
      } catch {
        logger.debug('Failed to parse session-end insight JSON, using fallback')
      }
    }
  } catch (error) {
    logger.warn(`Session-end insight generation failed: ${getErrorMessage(error)}`)
  }

  return {
    summary: truncate(lastUserText, 100),
    emotionalShift: 'neutral→neutral',
    unfinishedThoughts: [],
  }
}
