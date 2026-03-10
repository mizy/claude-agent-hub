/**
 * Chat prompt assembly — build full prompt with client context, memory, history, images, files
 */

import { loadConfig } from '../../config/loadConfig.js'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { buildClientPrompt, wrapMemoryContext, wrapHistoryContext, type PromptMode } from '../../prompts/chatPrompts.js'
import { getRecentConversations } from '../../store/conversationLog.js'
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

  // Inject recent history for new sessions (only in/out, deduplicated)
  // Skip in minimal mode
  let historyRaw = ''
  if (mode === 'full' && willStartNewSession) {
    const recent = getRecentConversations(chatId, 4)
      .filter(e => e.dir === 'in' || e.dir === 'out')
    if (recent.length > 0) {
      // Deduplicate consecutive entries with same dir+text
      const deduped = recent.filter((e, i) =>
        i === 0 || e.dir !== recent[i - 1]!.dir || e.text !== recent[i - 1]!.text
      )
      historyRaw = deduped
        .map(e => {
          const role = e.dir === 'in' ? '用户' : 'AI'
          const content = e.text.length > 400 ? e.text.slice(0, 397) + '...' : e.text
          return `[${role}] ${content}`
        })
        .join('\n')
    }
  }

  // Retrieve relevant memories: on new session OR every N turns (skip in minimal mode)
  const currentTurnCount = getSession(chatId)?.turnCount ?? 0
  const shouldRefreshMemory = willStartNewSession ||
    (currentTurnCount > 0 && currentTurnCount % MEMORY_REFRESH_INTERVAL === 0)
  let memoryRaw = ''
  if (mode === 'full' && effectiveText && shouldRefreshMemory) {
    try {
      const cached = memoryCache.get(chatId)
      if (cached && Date.now() - cached.fetchedAt < MEMORY_CACHE_TTL_MS) {
        memoryRaw = cached.result
        logger.debug(`reused cached memory context (${memoryRaw.length} chars) [${chatId.slice(0, 8)}]`)
      } else {
        const context = await retrieveAllMemoryContext(effectiveText, {
          maxResults: config.memory.chatMemory.maxMemories,
        })
        if (context) {
          memoryRaw = context
          memoryCache.set(chatId, { result: context, fetchedAt: Date.now() })
          logger.debug(`injected memory context (${context.length} chars) [${chatId.slice(0, 8)}]`)
        }
      }
    } catch (e) {
      logger.debug(`memory retrieval failed: ${getErrorMessage(e)}`)
    }
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

  // Assemble: system context → consciousness block → memory → history → user message → images → files
  let prompt =
    clientPrefix + consciousnessTotal + wrapMemoryContext(memoryRaw) + wrapHistoryContext(historyRaw) + effectiveText
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
