/**
 * Chat prompt assembly — build full prompt with client context, memory, history, images, files
 */

import { loadConfig } from '../../config/loadConfig.js'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { buildClientPrompt, wrapMemoryContext, type PromptMode } from '../../prompts/chatPrompts.js'
import { getRecentConversations } from '../../store/conversationLog.js'
import { saveChatSummary, loadChatSummary } from '../../store/chatSummaryStore.js'
import { generateChatContextSummary } from '../../consciousness/generateSummary.js'
import { retrieveAllMemoryContext } from '../../memory/index.js'
import { loadSelfModel, loadInnerState } from '../../consciousness/index.js'
import { buildConsciousnessBlock } from './buildConsciousnessBlock.js'
import { isClaudeModelBackend, selectModel } from './selectModel.js'
import { getModelOverride } from './sessionManager.js'
import { buildFileInlineSection } from './chatInputParser.js'
import type { ClientContext } from './types.js'

const logger = createLogger('chat-prompt-builder')

/** Track last consciousness injection time per chatId for incremental resume injection */
const lastInjectedAt = new Map<string, number>()

export interface FullPromptResult {
  /** System-level context (persona, consciousness, safety) → --append-system-prompt */
  systemPrompt: string
  /** User-level content (memory, history, user text, images, files) */
  prompt: string
}

/** Build full prompt: client context + memory + history + user text + images + files
 *  mode='minimal' skips agent, memory, and history — for subagent/task internal calls */
export async function buildFullPrompt(
  chatId: string,
  effectiveText: string,
  willStartNewSession: boolean,
  client: ClientContext | undefined,
  images: string[] | undefined,
  config: Awaited<ReturnType<typeof loadConfig>>,
  runtime?: { backend?: string; model?: string },
  files?: string[],
  mode: PromptMode = 'full',
  onStatus?: (text: string) => void
): Promise<FullPromptResult> {
  // Pre-load innerState + selfModel for reuse across prompt assembly
  let cachedInnerState: ReturnType<typeof loadInnerState> | undefined
  let promptMood: import('../../consciousness/innerState.js').MoodState | undefined
  let promptState: { fatigue: number; idleness: number; engagement: number } | undefined
  let promptNarrative: string | undefined
  if (mode === 'full') {
    try {
      cachedInnerState = loadInnerState()
      promptMood = cachedInnerState.mood
      // Also pre-load selfModel for narrative (used in [我是谁])
      if (willStartNewSession) {
        const model = loadSelfModel()
        if (model?.narrative) promptNarrative = model.narrative
        if (model?.state) {
          promptState = {
            fatigue: model.state.fatigue ?? 0,
            idleness: model.state.idleness ?? 0,
            engagement: model.state.engagement ?? 0,
          }
        }
      }
    } catch { /* ignore — non-critical */ }
  }

  const clientPrompt = client
    ? buildClientPrompt(client, runtime, mode, {
        isNewSession: willStartNewSession,
        userMessage: effectiveText,
        mood: promptMood,
        state: promptState,
        narrative: promptNarrative,
        personalityAppend: config.bot?.personalityAppend,
      })
    : { systemPrompt: '', dynamicContext: '' }

  // Inject conversation context for new sessions (e.g. after daemon restart).
  // Claude Code session handles in-session context; we only need this on fresh start.
  // Strategy: recent 8 messages verbatim + LLM summary of older history (cached per chatId).
  const RECENT_RAW_COUNT = 10
  const OLDER_HISTORY_COUNT = 30
  let historySummary = ''
  let historyRaw = ''

  // Prepare async tasks to run in parallel: summary generation + memory retrieval
  let summaryPromise: Promise<string | null> | undefined
  let memoryPromise: Promise<string | null> | undefined

  if (mode === 'full' && willStartNewSession) {
    const allRecent = getRecentConversations(chatId, OLDER_HISTORY_COUNT)
      .filter(e => e.dir === 'in' || e.dir === 'out')

    if (allRecent.length > 0) {
      const cached = loadChatSummary(chatId)
      if (cached) {
        const summaryTime = new Date(cached.updatedAt).getTime()
        const gapMessages = allRecent.filter(e => new Date(e.ts).getTime() > summaryTime)

        // Always inject cached summary + all gap messages — no LLM re-generation on session restart
        historySummary = cached.summary
        // Ensure at least RECENT_RAW_COUNT raw messages: gap messages + pre-summary backfill
        const rawMessages = gapMessages.length >= RECENT_RAW_COUNT
          ? gapMessages
          : (() => {
              const preSummary = allRecent.filter(e => new Date(e.ts).getTime() <= summaryTime)
              const backfillCount = RECENT_RAW_COUNT - gapMessages.length
              return [...preSummary.slice(-backfillCount), ...gapMessages]
            })()
        if (rawMessages.length > 0) {
          historyRaw = rawMessages
            .map(e => `[${e.dir === 'in' ? '用户' : 'AI'}] ${e.text}`)
            .join('\n')
        }
        logger.debug(`injected cached summary (${cached.summary.length} chars) + ${gapMessages.length} gap messages [${chatId.slice(0, 8)}]`)
      } else {
        // No cache: inject last 8 raw + generate summary for older messages
        const recentRaw = allRecent.slice(-RECENT_RAW_COUNT)
        historyRaw = recentRaw
          .map(e => `[${e.dir === 'in' ? '用户' : 'AI'}] ${e.text}`)
          .join('\n')

        const olderMessages = allRecent.slice(0, -RECENT_RAW_COUNT)
        if (olderMessages.length >= 2) {
          const msgs = olderMessages.map(e => ({
            role: (e.dir === 'in' ? 'user' : 'assistant') as 'user' | 'assistant',
            text: e.text,
          }))
          summaryPromise = generateChatContextSummary(msgs).catch(e => {
            logger.debug(`on-demand summary failed: ${getErrorMessage(e)}`)
            return null
          })
        }
      }
    }
  }

  // Retrieve relevant memories: full retrieval on new session, entity-triggered on resume
  if (mode === 'full' && willStartNewSession && effectiveText) {
    onStatus?.('🔍 检索记忆中...')
    memoryPromise = retrieveAllMemoryContext(effectiveText, {
      maxResults: config.memory.chatMemory.maxMemories,
    }).catch(e => {
      logger.debug(`memory retrieval failed: ${getErrorMessage(e)}`)
      return null
    })
  }
  // Resume path: no memory injection — CLI already has full session context via --resume

  if (summaryPromise) {
    onStatus?.('📝 构建对话上下文...')
  }

  // Await parallel tasks together
  const [summaryResult, memoryResult] = await Promise.all([
    summaryPromise ?? Promise.resolve(null),
    memoryPromise ?? Promise.resolve(null),
  ])

  if (summaryResult) {
    saveChatSummary(chatId, summaryResult)
    historySummary = summaryResult
    logger.debug(`generated history summary (${summaryResult.length} chars) [${chatId.slice(0, 8)}]`)
  }

  const memoryRaw = memoryResult ?? ''
  if (memoryResult) {
    logger.debug(`injected memory context (${memoryResult.length} chars) [${chatId.slice(0, 8)}]`)
  }

  // ── Consciousness injection (delegated to buildConsciousnessBlock) ──
  // Consciousness is dynamic (mood, events, thoughts change per-turn) → user prompt
  const consciousnessTotal = mode === 'full'
    ? buildConsciousnessBlock({ chatId, willStartNewSession, cachedInnerState, lastInjectedAt })
    : ''

  // System prompt: static persona + safety (stable across turns)
  const systemPrompt = clientPrompt.systemPrompt

  // User prompt: dynamic context + consciousness + memory + history + user message + images + files
  // Dynamic parts (time, mood guidance, consciousness) are injected per-turn in user prompt
  const dynamicParts = [clientPrompt.dynamicContext, consciousnessTotal].filter(Boolean)
  const dynamicBlock = dynamicParts.length > 0 ? dynamicParts.join('\n\n') + '\n\n' : ''

  let historyBlock = ''
  if (historySummary) historyBlock += `## 历史对话摘要\n${historySummary}\n\n`
  if (historyRaw) historyBlock += `## 最近对话\n${historyRaw}\n\n`
  let prompt =
    dynamicBlock + wrapMemoryContext(memoryRaw) + historyBlock + effectiveText
  if (images?.length) {
    const imagePart = images
      .map(p => `[用户发送了图片，请使用 Read 工具查看后回复，路径→${p}←]`)
      .join('\n')
    prompt = prompt ? `${prompt}\n\n${imagePart}` : imagePart
  }
  if (files?.length) {
    const filePart = buildFileInlineSection(files)
    prompt = prompt ? `${prompt}\n\n${filePart}` : filePart
  }

  // Update lastInjectedAt for incremental resume injection tracking
  if (mode === 'full') {
    lastInjectedAt.set(chatId, Date.now())
    // Prevent unbounded growth: FIFO evict when map exceeds 500
    if (lastInjectedAt.size > 500) {
      let count = 0
      for (const key of lastInjectedAt.keys()) {
        if (count >= 100) break
        lastInjectedAt.delete(key)
        count++
      }
    }
  }

  return { systemPrompt, prompt }
}

/** Resolve model: inline keyword > session override > auto-select (Claude only) */
export function resolveModel(
  effectiveText: string,
  hasImages: boolean,
  inlineModel: string | undefined,
  chatId: string,
  backendOverride: string | undefined,
  config: Awaited<ReturnType<typeof loadConfig>>
): string | undefined {
  const modelOverride = inlineModel ?? getModelOverride(chatId)
  const resolvedBackendType = backendOverride
    ? config.backends[backendOverride]?.type ?? backendOverride
    : config.backends[config.defaultBackend]?.type ?? 'claude-code'
  const isClaudeBackend = isClaudeModelBackend(resolvedBackendType)
  return modelOverride
    ? modelOverride
    : isClaudeBackend
      ? selectModel(effectiveText, { hasImages })
      : undefined
}
