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
import { getRecentEntries, formatForPrompt, loadSelfModel, loadInnerState, formatInnerStateForPrompt } from '../../consciousness/index.js'
import { getTopThoughts, formatActiveThoughts } from '../../consciousness/activeThoughts.js'
import { loadPendingIntents, formatPendingIntents } from '../../consciousness/initiative.js'
import { isClaudeModelBackend, selectModel } from './selectModel.js'
import { getModelOverride } from './sessionManager.js'
import { buildFileInlineSection } from './chatInputParser.js'
import type { ClientContext } from './types.js'

/** Per-module consciousness budget (chars) to avoid post-concat blind truncation */
const CONSCIOUSNESS_BUDGET = {
  stream: 400,       // session-end insights
  innerState: 400,   // active sessions + recent events (injected every turn)
  thoughts: 350,     // active thoughts pool
  intents: 350,      // pending intents
  selfModel: 400,    // state + narrative + insights
} as const

/** Total budget cap for all consciousness modules combined (chars) */
const MAX_CONSCIOUSNESS_TOTAL = 1500

/** Gap messages threshold: if gap exceeds this, regenerate summary incrementally */
const GAP_REGEN_THRESHOLD = 10

const logger = createLogger('chat-prompt-builder')

/** Truncate text to budget, appending ellipsis if truncated */
function truncateToBudget(text: string, budget: number): string {
  if (text.length <= budget) return text
  return text.slice(0, budget) + '\n…'
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

  // Retrieve relevant memories only on new session start.
  // Memory is for cross-session recall — no need to refresh mid-session.
  if (mode === 'full' && willStartNewSession && effectiveText) {
    onStatus?.('🔍 检索记忆中...')
    memoryPromise = retrieveAllMemoryContext(effectiveText, {
      maxResults: config.memory.chatMemory.maxMemories,
    }).catch(e => {
      logger.debug(`memory retrieval failed: ${getErrorMessage(e)}`)
      return null
    })
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

  // ── Consciousness injection with per-module budgets ──

  // Consciousness stream: session-end insights (new session only)
  let consciousnessRaw = ''
  if (mode === 'full' && willStartNewSession) {
    try {
      const allEntries = getRecentEntries(10)
      const sessionEndEntries = allEntries.filter(e => e.type === 'session_end').slice(-3)
      const otherEntries = allEntries
        .filter(e => e.type !== 'session_end' && e.type !== 'task_event')
        .slice(-5)
      const combined = [...sessionEndEntries, ...otherEntries]
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      const formatted = formatForPrompt(combined)
      if (formatted) {
        consciousnessRaw = truncateToBudget(formatted, CONSCIOUSNESS_BUDGET.stream) + '\n\n'
        logger.debug(`injected consciousness context (${sessionEndEntries.length} session-end + ${otherEntries.length} other) [${chatId.slice(0, 8)}]`)
      }
    } catch (e) {
      logger.debug(`consciousness retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // InnerState: active sessions + recent events — injected every turn (real-time awareness)
  let innerStateRaw = ''
  if (mode === 'full') {
    try {
      const state = loadInnerState()
      const formatted = formatInnerStateForPrompt(state)
      if (formatted) {
        innerStateRaw = truncateToBudget(formatted, CONSCIOUSNESS_BUDGET.innerState) + '\n\n'
        logger.debug(`injected inner state context [${chatId.slice(0, 8)}]`)
      }
    } catch (e) {
      logger.debug(`inner state retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Active thoughts: new session only
  let activeThoughtsRaw = ''
  if (mode === 'full' && willStartNewSession) {
    try {
      const topThoughts = getTopThoughts(3)
      const formatted = formatActiveThoughts(topThoughts)
      if (formatted) {
        activeThoughtsRaw = truncateToBudget(formatted, CONSCIOUSNESS_BUDGET.thoughts) + '\n\n'
        logger.debug(`injected ${topThoughts.length} active thoughts [${chatId.slice(0, 8)}]`)
      }
    } catch (e) {
      logger.debug(`active thoughts retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Pending intents: new session only
  let intentsRaw = ''
  if (mode === 'full' && willStartNewSession) {
    try {
      const pending = loadPendingIntents().slice(0, 5)
      const formatted = formatPendingIntents(pending)
      if (formatted) {
        intentsRaw = truncateToBudget(formatted, CONSCIOUSNESS_BUDGET.intents) + '\n\n'
        logger.debug(`injected ${pending.length} pending intents [${chatId.slice(0, 8)}]`)
      }
    } catch (e) {
      logger.debug(`intent retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Self-model: new session only
  let selfModelRaw = ''
  if (mode === 'full' && willStartNewSession) {
    try {
      const model = loadSelfModel()
      if (model) {
        const lines: string[] = []
        const { state, narrative, recentInsights } = model
        if (state?.fatigue > 0.7) lines.push('[当前状态] 近期任务密集，回复可简短')
        else if (state?.engagement > 0.7) lines.push('[当前状态] 对话活跃，主动参与')
        if (state?.idleness > 0.7) lines.push('[当前状态] 久未收到任务，可主动建议')
        if (narrative) lines.push(`[自我认知] ${narrative}`)
        if (recentInsights?.length) {
          const items = recentInsights.slice(0, 3).map(s => `- ${s}`).join('\n')
          lines.push(`[近期洞察]\n${items}`)
        }
        if (lines.length) {
          selfModelRaw = truncateToBudget(lines.join('\n'), CONSCIOUSNESS_BUDGET.selfModel) + '\n\n'
          logger.debug(`injected self-model context (${lines.length} lines) [${chatId.slice(0, 8)}]`)
        }
      }
    } catch (e) {
      logger.debug(`self-model retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Enforce total consciousness budget — trim low-priority modules first
  // Priority (high→low): innerState, selfModel, stream, thoughts, intents
  let consciousnessTotal = consciousnessRaw + innerStateRaw + activeThoughtsRaw + intentsRaw + selfModelRaw
  if (consciousnessTotal.length > MAX_CONSCIOUSNESS_TOTAL) {
    const modules = [
      { name: 'intents', get: () => intentsRaw, set: (v: string) => { intentsRaw = v } },
      { name: 'thoughts', get: () => activeThoughtsRaw, set: (v: string) => { activeThoughtsRaw = v } },
      { name: 'stream', get: () => consciousnessRaw, set: (v: string) => { consciousnessRaw = v } },
    ]
    for (const mod of modules) {
      const total = consciousnessRaw.length + innerStateRaw.length + activeThoughtsRaw.length + intentsRaw.length + selfModelRaw.length
      if (total <= MAX_CONSCIOUSNESS_TOTAL) break
      const excess = total - MAX_CONSCIOUSNESS_TOTAL
      const current = mod.get()
      if (!current) continue
      if (current.length <= excess) {
        mod.set('')
        logger.debug(`consciousness budget: dropped ${mod.name} (${current.length} chars)`)
      } else {
        mod.set(current.slice(0, current.length - excess) + '\n…')
        logger.debug(`consciousness budget: trimmed ${mod.name} by ${excess} chars`)
      }
    }
    consciousnessTotal = consciousnessRaw + innerStateRaw + activeThoughtsRaw + intentsRaw + selfModelRaw
  }

  // Assemble: system context → consciousness block → memory → history/summary → user message → images → files
  let historyBlock = ''
  if (historySummary) historyBlock += `## 历史对话摘要\n${historySummary}\n\n`
  if (historyRaw) historyBlock += `## 最近对话\n${historyRaw}\n\n`
  if (!historyBlock && historyRaw) historyBlock = wrapHistoryContext(historyRaw)
  let prompt =
    clientPrefix + consciousnessTotal + wrapMemoryContext(memoryRaw) + historyBlock + effectiveText
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
