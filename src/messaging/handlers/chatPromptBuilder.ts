/**
 * Chat prompt assembly — build full prompt with client context, memory, history, images, files
 */

import { loadConfig } from '../../config/loadConfig.js'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { buildClientPrompt, wrapMemoryContext, wrapHistoryContext, type PromptMode } from '../../prompts/chatPrompts.js'
import { getRecentConversations } from '../../store/conversationLog.js'
import { saveChatSummary, loadChatSummary } from '../../store/chatSummaryStore.js'
import { generateChatContextSummary } from '../../consciousness/generateSummary.js'
import { retrieveAllMemoryContext, retrieveRelevantMemories } from '../../memory/index.js'
import { extractEntities as extractMemoryEntities } from '../../memory/entityIndex.js'
import { loadSelfModel, loadInnerState } from '../../consciousness/index.js'
import { buildConsciousnessBlock } from './buildConsciousnessBlock.js'
import { isClaudeModelBackend, selectModel } from './selectModel.js'
import { getModelOverride } from './sessionManager.js'
import { buildFileInlineSection } from './chatInputParser.js'
import type { ClientContext } from './types.js'

/** Resume memory retrieval budget (chars) */
const RESUME_MEMORY_BUDGET = 500

/** Gap messages threshold: if gap exceeds this, regenerate summary incrementally */
const GAP_REGEN_THRESHOLD = 10

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

  const clientSystemPrompt = client
    ? buildClientPrompt(client, runtime, mode, {
        isNewSession: willStartNewSession,
        userMessage: effectiveText,
        mood: promptMood,
        state: promptState,
        narrative: promptNarrative,
        personalityAppend: config.bot?.personalityAppend,
      })
    : ''

  // Inject conversation context for new sessions (e.g. after daemon restart).
  // Claude Code session handles in-session context; we only need this on fresh start.
  // Strategy: recent 8 messages verbatim + LLM summary of older history (cached per chatId).
  const RECENT_RAW_COUNT = 8
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

        if (gapMessages.length > GAP_REGEN_THRESHOLD) {
          // Too many gap messages: regenerate summary incrementally (old summary + gap → new summary)
          const msgs = gapMessages.map(e => ({
            role: (e.dir === 'in' ? 'user' : 'assistant') as 'user' | 'assistant',
            text: e.text,
          }))
          summaryPromise = generateChatContextSummary(msgs, cached.summary).catch(e => {
            logger.debug(`incremental summary regen failed: ${getErrorMessage(e)}`)
            return null
          })
          // Still show last few raw messages while summary generates
          historyRaw = gapMessages.slice(-RECENT_RAW_COUNT)
            .map(e => `[${e.dir === 'in' ? '用户' : 'AI'}] ${e.text}`)
            .join('\n')
          logger.debug(`regenerating summary: ${gapMessages.length} gap messages exceed threshold [${chatId.slice(0, 8)}]`)
        } else {
          // Cache hit with manageable gap: inject summary + gap messages
          historySummary = cached.summary
          if (gapMessages.length > 0) {
            historyRaw = gapMessages
              .map(e => `[${e.dir === 'in' ? '用户' : 'AI'}] ${e.text}`)
              .join('\n')
          }
          logger.debug(`injected cached summary (${cached.summary.length} chars) + ${gapMessages.length} gap messages [${chatId.slice(0, 8)}]`)
        }
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
  } else if (mode === 'full' && !willStartNewSession && effectiveText) {
    // 4.2 Resume: entity-triggered memory retrieval — lightweight, no LLM
    try {
      const queryEntities = extractMemoryEntities(effectiveText)
      if (queryEntities.length > 0) {
        logger.debug(`resume: detected ${queryEntities.length} entities in query, triggering memory retrieval [${chatId.slice(0, 8)}]`)
        memoryPromise = retrieveRelevantMemories(effectiveText, {
          maxResults: 3,
        }).then(memories => {
          if (!memories.length) return null
          // Format with budget limit
          const lines = memories.map(m => `- ${m.content}`).join('\n')
          const result = `[相关记忆]\n${lines}`
          return result.length > RESUME_MEMORY_BUDGET
            ? result.slice(0, RESUME_MEMORY_BUDGET) + '\n…'
            : result
        }).catch(e => {
          logger.debug(`resume memory retrieval failed: ${getErrorMessage(e)}`)
          return null
        })
      }
    } catch (e) {
      logger.debug(`resume entity extraction failed: ${getErrorMessage(e)}`)
    }
  }

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
  const consciousnessTotal = mode === 'full'
    ? buildConsciousnessBlock({ chatId, willStartNewSession, cachedInnerState, lastInjectedAt })
    : ''

  // System prompt: persona + consciousness (static/session-level context)
  const systemParts = [clientSystemPrompt, consciousnessTotal].filter(Boolean)
  const systemPrompt = systemParts.join('\n\n')

  // User prompt: memory + history + user message + images + files
  let historyBlock = ''
  if (historySummary) historyBlock += `## 历史对话摘要\n${historySummary}\n\n`
  if (historyRaw) historyBlock += `## 最近对话\n${historyRaw}\n\n`
  let prompt =
    wrapMemoryContext(memoryRaw) + historyBlock + effectiveText
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
