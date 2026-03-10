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
import { retrieveAllMemoryContext } from '../../memory/index.js'
import { getRecentEntries, formatForPrompt, loadSelfModel } from '../../consciousness/index.js'
import { getTopThoughts, formatActiveThoughts } from '../../consciousness/activeThoughts.js'
import { loadPendingIntents, formatPendingIntents } from '../../consciousness/initiative.js'
import { isClaudeModelBackend, selectModel } from './selectModel.js'
import { getModelOverride, getSession } from './sessionManager.js'
import { buildFileInlineSection } from './chatInputParser.js'
import type { ClientContext } from './types.js'

/** How often (in turns) to re-retrieve memory within a session */
const MEMORY_REFRESH_INTERVAL = 10

/** TTL cache: reuse memory result if re-fetched within this window (ms) */
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000
const memoryCache = new Map<string, { result: string; fetchedAt: number }>()

const logger = createLogger('chat-prompt-builder')

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
  mode: PromptMode = 'full'
): Promise<string> {
  const clientPrefix = client ? buildClientPrompt(client, runtime, mode) + '\n\n' : ''

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
        // Cache hit: inject summary + all messages AFTER the summary was generated
        historySummary = cached.summary
        const summaryTime = new Date(cached.updatedAt).getTime()
        const gapMessages = allRecent.filter(e => new Date(e.ts).getTime() > summaryTime)
        if (gapMessages.length > 0) {
          historyRaw = gapMessages
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

  // Retrieve relevant memories: on new session OR every N turns (skip in minimal mode)
  const currentTurnCount = getSession(chatId)?.turnCount ?? 0
  const shouldRefreshMemory = willStartNewSession ||
    (currentTurnCount > 0 && currentTurnCount % MEMORY_REFRESH_INTERVAL === 0)
  if (mode === 'full' && effectiveText && shouldRefreshMemory) {
    const cached = memoryCache.get(chatId)
    if (cached && Date.now() - cached.fetchedAt < MEMORY_CACHE_TTL_MS) {
      memoryPromise = Promise.resolve(cached.result)
      logger.debug(`reused cached memory context (${cached.result.length} chars) [${chatId.slice(0, 8)}]`)
    } else {
      // Start memory retrieval in parallel (don't await yet)
      memoryPromise = retrieveAllMemoryContext(effectiveText, {
        maxResults: config.memory.chatMemory.maxMemories,
      }).catch(e => {
        logger.debug(`memory retrieval failed: ${getErrorMessage(e)}`)
        return null
      })
    }
  }

  // Await parallel tasks together
  const [summaryResult, memoryResult] = await Promise.all([
    summaryPromise ?? Promise.resolve(null),
    memoryPromise ?? Promise.resolve(null),
  ])

  if (summaryResult) {
    saveChatSummary(chatId, summaryResult)
    historySummary = summaryResult
    logger.debug(`generated on-demand history summary (${summaryResult.length} chars) [${chatId.slice(0, 8)}]`)
  }

  let memoryRaw = ''
  if (memoryResult) {
    memoryRaw = memoryResult
    if (!memoryCache.has(chatId) || Date.now() - (memoryCache.get(chatId)?.fetchedAt ?? 0) >= MEMORY_CACHE_TTL_MS) {
      memoryCache.set(chatId, { result: memoryResult, fetchedAt: Date.now() })
    }
    logger.debug(`injected memory context (${memoryResult.length} chars) [${chatId.slice(0, 8)}]`)
  }

  // Inject consciousness stream for new sessions: recent session-end entries + other activity
  let consciousnessRaw = ''
  if (mode === 'full' && willStartNewSession) {
    try {
      const allEntries = getRecentEntries(10)
      // Prioritize session_end entries (consciousness chain), take up to 3
      const sessionEndEntries = allEntries.filter(e => e.type === 'session_end').slice(-3)
      // Also include recent non-session entries for context, up to 5
      const otherEntries = allEntries.filter(e => e.type !== 'session_end').slice(-5)
      const combined = [...sessionEndEntries, ...otherEntries]
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      let formatted = formatForPrompt(combined)
      // Cap consciousness context to avoid squeezing user message space
      if (formatted.length > 1000) {
        formatted = formatted.slice(0, 1000) + '\n…(truncated)'
      }
      if (formatted) {
        consciousnessRaw = formatted + '\n\n'
        logger.debug(`injected consciousness context (${sessionEndEntries.length} session-end + ${otherEntries.length} other) [${chatId.slice(0, 8)}]`)
      }
    } catch (e) {
      logger.debug(`consciousness retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Inject active thoughts for new sessions
  let activeThoughtsRaw = ''
  if (mode === 'full' && willStartNewSession) {
    try {
      const topThoughts = getTopThoughts(3)
      const formatted = formatActiveThoughts(topThoughts)
      if (formatted) {
        activeThoughtsRaw = formatted + '\n\n'
        logger.debug(`injected ${topThoughts.length} active thoughts [${chatId.slice(0, 8)}]`)
      }
    } catch (e) {
      logger.debug(`active thoughts retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Inject pending intents for new sessions
  let intentsRaw = ''
  if (mode === 'full' && willStartNewSession) {
    try {
      const pending = loadPendingIntents().slice(0, 5)
      const formatted = formatPendingIntents(pending)
      if (formatted) {
        intentsRaw = formatted + '\n\n'
        logger.debug(`injected ${pending.length} pending intents [${chatId.slice(0, 8)}]`)
      }
    } catch (e) {
      logger.debug(`intent retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Inject self-model state for new sessions
  let selfModelRaw = ''
  if (mode === 'full' && willStartNewSession) {
    try {
      const model = loadSelfModel()
      if (model) {
        const lines: string[] = []
        const { state, narrative, recentInsights } = model
        // Mutually exclusive: fatigue takes priority over engagement
        if (state?.fatigue > 0.7) lines.push('[当前状态] 近期任务密集，回复可简短')
        else if (state?.engagement > 0.7) lines.push('[当前状态] 对话活跃，主动参与')
        if (state?.idleness > 0.7) lines.push('[当前状态] 久未收到任务，可主动建议')
        if (narrative) lines.push(`[自我认知] ${narrative}`)
        if (recentInsights?.length) {
          const items = recentInsights.slice(0, 3).map(s => `- ${s}`).join('\n')
          lines.push(`[近期洞察]\n${items}`)
        }
        if (lines.length) {
          selfModelRaw = lines.join('\n') + '\n\n'
          logger.debug(`injected self-model context (${lines.length} lines) [${chatId.slice(0, 8)}]`)
        }
      }
    } catch (e) {
      logger.debug(`self-model retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Cap total consciousness injection (consciousness + thoughts + intents + selfModel) to avoid squeezing user message space
  const MAX_CONSCIOUSNESS_TOTAL = 2000
  let consciousnessTotal = consciousnessRaw + activeThoughtsRaw + intentsRaw + selfModelRaw
  if (consciousnessTotal.length > MAX_CONSCIOUSNESS_TOTAL) {
    consciousnessTotal = consciousnessTotal.slice(0, MAX_CONSCIOUSNESS_TOTAL) + '\n…(truncated)\n\n'
  }

  // Assemble: system context → consciousness block → memory → history/summary → user message → images → files
  // historyBlock = optional summary of older history + recent raw messages
  let historyBlock = ''
  if (historySummary) historyBlock += `## 历史对话摘要\n${historySummary}\n\n`
  if (historyRaw) historyBlock += `## 最近对话\n${historyRaw}\n\n`
  if (!historyBlock && historyRaw) historyBlock = wrapHistoryContext(historyRaw)
  let prompt =
    clientPrefix + consciousnessTotal + wrapMemoryContext(memoryRaw) + historyBlock + effectiveText
  if (images?.length) {
    // Use →path← delimiters so ABSOLUTE_RE (lookbehind: \s|["'`(]) won't match
    // and imageExtractor won't re-send the user's original image in the response
    const imagePart = images
      .map(p => `[用户发送了图片，请使用 Read 工具查看后回复，路径→${p}←]`)
      .join('\n')
    prompt = prompt ? `${prompt}\n\n${imagePart}` : imagePart
  }
  if (files?.length) {
    const filePart = buildFileInlineSection(files)
    prompt = prompt ? `${prompt}\n\n${filePart}` : filePart
  }
  return prompt
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
