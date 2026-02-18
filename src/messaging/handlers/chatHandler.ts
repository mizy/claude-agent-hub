/**
 * Chat handler — thin coordination layer
 * Routes text messages to AI backend with session management, streaming, and image detection
 */

import { invokeBackend } from '../../backend/index.js'
import { loadConfig } from '../../config/loadConfig.js'
import { createLogger } from '../../shared/logger.js'
import { formatErrorMessage } from '../../shared/formatErrorMessage.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { buildClientPrompt } from '../../prompts/chatPrompts.js'
import { logConversation, getRecentConversations } from './conversationLog.js'
import { getSession, setSession, clearSession, enqueueChat, destroySessions, getModelOverride, getBackendOverride, shouldResetSession, incrementTurn } from './sessionManager.js'
import { createStreamHandler, sendFinalResponse } from './streamingHandler.js'
import { sendDetectedImages } from './imageExtractor.js'
import { triggerChatMemoryExtraction } from './chatMemoryExtractor.js'
import { trackEpisodeTurn, destroyEpisodeTrackers, flushEpisode } from './episodeExtractor.js'
import { retrieveAllMemoryContext, addMemory } from '../../memory/index.js'
import { getRegisteredBackends } from '../../backend/resolveBackend.js'
import type { MessengerAdapter, ClientContext } from './types.js'

const logger = createLogger('chat-handler')

const DEFAULT_MAX_LENGTH = 4096

// Per-chatId AbortController for interrupting active AI calls
const activeControllers = new Map<string, AbortController>()

// Backends that understand Claude model names (opus/sonnet/haiku)
const CLAUDE_MODEL_BACKENDS = new Set(['claude-code', 'codebuddy'])

/** Check if a backend supports Claude model names for auto-selection */
function isClaudeModelBackend(backendType?: string): boolean {
  return !backendType || CLAUDE_MODEL_BACKENDS.has(backendType)
}

// ── Model Selection ──

/** Parse inline model keyword from message start (e.g. "@opus question" or "opus 帮我看看") */
export function parseInlineModel(text: string): { model?: string; actualText: string } {
  const pattern = /^@?(opus|sonnet|haiku)(?:\s|$)/i
  const match = text.match(pattern)
  if (!match) return { actualText: text }
  const model = match[1]!.toLowerCase()
  const actualText = text.slice(match[0].length).trim()
  return { model, actualText }
}

/** Keywords that signal deep reasoning requiring opus */
const OPUS_KEYWORDS = /(?:重构|refactor|架构|architect|迁移|migrate|设计|design|审查|review|分析|analyze|debug|调试|思考|think|深入|详细|detailed|复杂|complex|解释|explain|优化|optimize|比较|对比|compare|总结|summarize|推理|reason|elaborate)/i

/** Keywords for simple queries that haiku can handle */
const HAIKU_PATTERNS = /^(?:(?:你好|hi|hello|ping|status|状态|帮助|help|谢谢|thanks|ok|好的|收到|嗯)[!！？?。.]*|\/\w+.*)$/i

/** Pick model: override → haiku (trivial) → sonnet (default) → opus (complex) */
function selectModel(text: string, ctx: { hasImages?: boolean; modelOverride?: string }): string {
  if (ctx.modelOverride) return ctx.modelOverride
  if (ctx.hasImages) return 'opus'
  if (HAIKU_PATTERNS.test(text.trim())) return 'haiku'
  if (text.length > 150 || OPUS_KEYWORDS.test(text)) return 'opus'
  return 'sonnet'
}

// ── Benchmark ──

interface BenchmarkTiming {
  start: number
  promptReady: number
  parallelStart: number
  firstChunk: number
  backendDone: number
  responseSent: number
}

function createBenchmark(): BenchmarkTiming {
  const now = Date.now()
  return { start: now, promptReady: 0, parallelStart: 0, firstChunk: 0, backendDone: 0, responseSent: 0 }
}

function formatBenchmark(t: BenchmarkTiming, extra?: { slotWaitMs?: number; apiMs?: number; costUsd?: number; model?: string; backend?: string }): string {
  const total = t.responseSent - t.start
  const prep = t.promptReady - t.start
  const parallel = t.parallelStart - t.promptReady
  const ttfc = t.firstChunk ? t.firstChunk - t.parallelStart : 0
  const inference = t.backendDone - t.parallelStart
  const send = t.responseSent - t.backendDone

  const modelLabel = extra?.model ? ` [${extra.model}]` : ''
  const backendLabel = extra?.backend ? ` (${extra.backend})` : ''
  const lines = [
    `**Benchmark** (${(total / 1000).toFixed(1)}s total)${modelLabel}${backendLabel}`,
    `- 准备阶段: ${prep}ms`,
    `- 并行启动: ${parallel}ms` + (extra?.slotWaitMs ? ` (含排队 ${extra.slotWaitMs}ms)` : ''),
    `- 首 chunk: ${ttfc}ms` + (ttfc > 0 ? '' : ' (无流式)'),
    `- 后端推理: ${(inference / 1000).toFixed(1)}s` + (extra?.apiMs ? ` (API: ${(extra.apiMs / 1000).toFixed(1)}s)` : ''),
    `- 发送回复: ${send}ms`,
  ]
  if (extra?.costUsd !== undefined) {
    lines.push(`- 费用: $${extra.costUsd.toFixed(4)}`)
  }
  return lines.join('\n')
}

let benchmarkEnabled = false

/** Toggle benchmark mode on/off */
export function toggleBenchmark(): boolean {
  benchmarkEnabled = !benchmarkEnabled
  return benchmarkEnabled
}

/** Check if benchmark is enabled */
export function isBenchmarkEnabled(): boolean {
  return benchmarkEnabled
}

// ── Public API ──

export interface ChatOptions {
  /** Max message length, default 4096 (Telegram limit) */
  maxMessageLength?: number
  /** Client context injected to AI for format constraints */
  client?: ClientContext
  /** Optional image file paths from the user message */
  images?: string[]
}

/**
 * Handle a text message: enqueue per-chatId for serial processing, call AI backend.
 * If a previous AI call is in progress for this chatId, abort it (last-write-wins).
 */
export async function handleChat(
  chatId: string,
  text: string,
  messenger: MessengerAdapter,
  options?: ChatOptions
): Promise<void> {
  // Abort previous in-flight AI call for this chat (last-write-wins)
  const prev = activeControllers.get(chatId)
  if (prev) {
    logger.info(`⚡ interrupting previous AI call [${chatId.slice(0, 8)}]`)
    prev.abort()
  }

  return enqueueChat(chatId, () =>
    handleChatInternal(chatId, text, messenger, options).catch(e => {
      const msg = getErrorMessage(e)
      logger.warn(`chat queue error [${chatId.slice(0, 8)}]: ${msg}`)
      messenger.reply(chatId, `❌ 处理失败: ${msg}`).catch(re => {
        logger.debug(`Failed to send error reply: ${getErrorMessage(re)}`)
      })
    })
  )
}

/**
 * Clear the session for a chatId.
 */
export function clearChatSession(chatId: string): boolean {
  flushEpisode(chatId)
  return clearSession(chatId)
}

/**
 * Get session info for a chatId.
 */
export function getChatSessionInfo(chatId: string) {
  return getSession(chatId)
}

/**
 * Cleanup all sessions and stop timers. Call on daemon shutdown.
 */
export function destroyChatHandler(): void {
  // Abort all active AI calls
  for (const controller of activeControllers.values()) {
    controller.abort()
  }
  activeControllers.clear()
  destroyEpisodeTrackers()
  destroySessions()
}

// ── Internal ──

// Cached backend override regex (invalidated when backend list changes)
let cachedBackendPattern: RegExp | null = null
let cachedBackendList: string | null = null

/** Parse backend override from message text (e.g. "@iflow question" or "/use opencode\nquestion") */
export async function parseBackendOverride(text: string): Promise<{ backend?: string; actualText: string }> {
  const registeredBackends = getRegisteredBackends()

  // Also include named backends from config (e.g. "local" -> type:"openai")
  const config = await loadConfig()
  const namedBackends = Object.keys(config.backends || {})

  const allBackends = [...new Set([...registeredBackends, ...namedBackends])]
  const backendListKey = allBackends.join(',')

  // Reuse cached regex if backend list hasn't changed
  if (backendListKey !== cachedBackendList) {
    cachedBackendPattern = new RegExp(`^[@/](?:backend:|use\\s+)?(${allBackends.join('|')})(?:\\s|\\n)`, 's')
    cachedBackendList = backendListKey
  }

  const match = text.match(cachedBackendPattern!)
  if (!match) return { actualText: text }

  const backend = match[1]
  const actualText = text.slice(match[0].length).trim()
  return { backend, actualText }
}

async function handleChatInternal(
  chatId: string,
  text: string,
  messenger: MessengerAdapter,
  options?: ChatOptions
): Promise<void> {
  const maxLen = options?.maxMessageLength ?? DEFAULT_MAX_LENGTH
  const platform = options?.client?.platform ?? 'unknown'
  const bench = createBenchmark()

  // Create AbortController for this chat turn
  const abortController = new AbortController()
  activeControllers.set(chatId, abortController)
  const { signal } = abortController

  // Strip Lark mention placeholders (@_user_1 etc.) before parsing backend override
  const mentionCleaned = text.replace(/@_\w+/g, '').trim()
  // Parse backend override from message (inline directive like @iflow or /use opencode)
  const { backend: inlineBackend, actualText } = await parseBackendOverride(mentionCleaned)
  // Parse inline model keyword (e.g. "@opus question" or "haiku 帮我看看")
  const { model: inlineModel, actualText: textAfterModel } = parseInlineModel(actualText || mentionCleaned)
  const effectiveText = textAfterModel || actualText || mentionCleaned

  // Auto-reset session if turn/token limits exceeded
  if (shouldResetSession(chatId)) {
    clearSession(chatId)
    logger.info(`♻️ session auto-reset [${chatId.slice(0, 8)}]`)
  }

  const session = getSession(chatId)
  const sessionId = session?.sessionId

  // Backend priority: inline message directive > session /backend override > config default
  const sessionBackend = getBackendOverride(chatId)
  const backendOverride = inlineBackend ?? sessionBackend
  logger.info(`💬 chat ${sessionId ? 'continue' : 'new'} [${chatId.slice(0, 8)}]${backendOverride ? ` [backend: ${backendOverride}]` : ''}`)

  // Record backend switch as a user preference memory
  if (inlineBackend && effectiveText) {
    try {
      const topic = effectiveText.length > 50 ? effectiveText.slice(0, 47) + '...' : effectiveText
      addMemory(
        `用户在讨论 "${topic}" 时选择使用 ${inlineBackend} backend`,
        'preference',
        { type: 'chat', chatId },
        { keywords: ['backend', inlineBackend, 'preference'], confidence: 0.7 },
      )
      logger.info(`记录 backend 偏好: ${inlineBackend} [${chatId.slice(0, 8)}]`)
    } catch (e) {
      logger.debug(`Failed to record backend preference: ${getErrorMessage(e)}`)
    }
  }

  // Log user message
  logConversation({
    ts: new Date().toISOString(),
    dir: 'in',
    platform,
    chatId,
    sessionId,
    text: effectiveText || (options?.images?.length ? '[图片消息]' : ''),
    images: options?.images,
  })

  // Load config early (cached — near-instant after daemon preload)
  const config = await loadConfig()

  // Build prompt with client context and optional images
  const hasImages = !!options?.images?.length
  const clientPrefix = options?.client ? buildClientPrompt(options.client) + '\n\n' : ''
  const images = options?.images

  // Detect backend change early — needed for history injection decision
  const sessionCreatedBy = session?.sessionBackendType
  const currentBackend = backendOverride ?? undefined
  const backendChanged = !!(sessionId && sessionCreatedBy !== currentBackend)
  if (backendChanged) {
    logger.info(`🔄 session backend changed (${sessionCreatedBy ?? 'default'} → ${currentBackend ?? 'default'}), starting new session`)
    // Flush episode on backend switch so the conversation boundary is captured
    flushEpisode(chatId)
  }

  // Session won't be reused if backend changed or inline backend specified
  const willStartNewSession = !sessionId || !!inlineBackend || backendChanged

  // Inject minimal recent history when starting a new session (backend switch, new chat, etc.)
  let historyContext = ''
  if (willStartNewSession) {
    const recent = getRecentConversations(chatId, 5)
    if (recent.length > 0) {
      const summaryLines = recent.map(e => {
        const role = e.dir === 'in' ? '用户' : 'AI'
        const content = e.text.length > 100 ? e.text.slice(0, 97) + '...' : e.text
        return `[${role}] ${content}`
      })
      historyContext = '[近期对话]\n' + summaryLines.join('\n') + '\n\n'
    }
  }

  // Retrieve relevant memories for context injection
  // Always retrieve if there's a query — chatMemory.enabled controls extraction, not retrieval
  let memoryContext = ''
  if (effectiveText) {
    try {
      const context = await retrieveAllMemoryContext(effectiveText, {
        maxResults: config.memory.chatMemory.maxMemories,
      })
      if (context) {
        memoryContext = context + '\n\n'
        logger.debug(`injected memory context (${context.length} chars) for chat [${chatId.slice(0, 8)}]`)
      }
    } catch (e) {
      logger.debug(`memory retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  let prompt = clientPrefix + memoryContext + historyContext + effectiveText
  if (images?.length) {
    const imagePart = images
      .map(p => `[用户发送了图片: ${p}，请使用 Read 工具查看这张图片并回复]`)
      .join('\n')
    prompt = prompt ? `${prompt}\n\n${imagePart}` : imagePart
  }

  // Model selection: inline keyword > session /model override > auto (haiku→sonnet→opus)
  // Only apply auto model selection for Claude backends; non-Claude backends ignore Claude model names
  const modelOverride = inlineModel ?? getModelOverride(chatId)
  const isClaudeBackend = isClaudeModelBackend(backendOverride)
  const model = isClaudeBackend || modelOverride ? selectModel(effectiveText, { hasImages, modelOverride }) : undefined
  bench.promptReady = Date.now()

  // Setup streaming with shared ref for placeholderId
  let placeholderId: string | null = null
  const streamHandlerState = { placeholderId: null as string | null }
  const { onChunk, stop: stopStreaming } = createStreamHandler(chatId, streamHandlerState, maxLen, messenger, bench)

  // Auto-stop streaming when aborted
  signal.addEventListener('abort', () => stopStreaming(), { once: true })

  // Parallel: send placeholder + start backend call
  // Placeholder ID is injected as soon as it resolves (before backend finishes)
  const placeholder = hasImages ? '🖼️ 已收到图片，分析中...' : '🤔 思考中...'
  const placeholderPromise = messenger.sendAndGetId(chatId, placeholder).then(pId => {
    placeholderId = pId
    streamHandlerState.placeholderId = pId
    return pId
  }).catch(e => {
    // Placeholder failure is non-critical — streaming edits won't work but final reply still sends
    logger.debug(`placeholder send failed: ${getErrorMessage(e)}`)
    return null
  })

  const chatMcp = config.backend.chat?.mcpServers ?? []

  bench.parallelStart = Date.now()

  // Long-running warning disabled: placeholder icon already indicates progress
  const clearLongRunningTimers = () => {}

  try {
    // Don't reuse session across different backends (session IDs are backend-specific)
    const effectiveSessionId = (inlineBackend || backendChanged) ? undefined : sessionId
    const [, result] = await Promise.all([
      placeholderPromise,
      invokeBackend({
        prompt,
        stream: true,
        skipPermissions: true,
        sessionId: effectiveSessionId,
        onChunk,
        disableMcp: chatMcp.length === 0,
        mcpServers: chatMcp.length > 0 ? chatMcp : undefined,
        model,
        backendType: backendOverride,
        signal,
      }),
    ])
    clearLongRunningTimers()
    bench.backendDone = Date.now()

    // Clean up controller reference (this turn is done)
    if (activeControllers.get(chatId) === abortController) {
      activeControllers.delete(chatId)
    }

    if (!result.ok) {
      // If cancelled by a new message, silently stop — new handler will take over
      if (result.error.type === 'cancelled') {
        logger.info(`🛑 AI call cancelled [${chatId.slice(0, 8)}], new message takes over`)
        stopStreaming()
        // Edit placeholder to indicate interruption (if it was sent)
        if (placeholderId) {
          await messenger.editMessage(chatId, placeholderId, '⚡ 已中断，处理新消息...').catch(e => logger.debug(`Edit placeholder failed: ${e}`))
        }
        return
      }
      const errorMsg = `❌ AI 调用失败: ${result.error.message}`
      if (placeholderId) {
        await messenger.editMessage(chatId, placeholderId, errorMsg)
      } else {
        await messenger.reply(chatId, errorMsg)
      }
      return
    }

    const response = result.value.response
    const newSessionId = result.value.sessionId
    const durationMs = Date.now() - bench.start
    logger.info(`→ reply ${response.length} chars (${(durationMs / 1000).toFixed(1)}s)`)

    // Log AI reply (with cost, model, and backend for aggregation)
    logConversation({
      ts: new Date().toISOString(),
      dir: 'out',
      platform,
      chatId,
      sessionId: newSessionId ?? sessionId,
      text: response,
      durationMs,
      costUsd: result.value.costUsd,
      model,
      backendType: backendOverride,
    })

    // Update session (track which backend created it for cross-backend detection)
    if (newSessionId) {
      setSession(chatId, newSessionId, backendOverride)
    }

    // Track turn count and estimated tokens for auto-reset
    incrementTurn(chatId, text.length, response.length)

    // Append completion marker so user knows the response is final
    const elapsedSec = ((Date.now() - bench.start) / 1000).toFixed(1)
    const backendType = backendOverride ?? 'claude-code'
    const modelLabel = model ? ` (${model})` : ''
    const completionMarker = `\n\n---\n⏱️ ${elapsedSec}s | ${backendType}${modelLabel}`
    const finalText = response + completionMarker

    // Stop streaming edits before sending final response to prevent race condition
    stopStreaming()
    await sendFinalResponse(chatId, finalText, maxLen, placeholderId, messenger)
    bench.responseSent = Date.now()

    // Benchmark (log + send to user) only when enabled
    if (benchmarkEnabled) {
      const benchStr = formatBenchmark(bench, {
        slotWaitMs: result.value.slotWaitMs,
        apiMs: result.value.durationApiMs,
        costUsd: result.value.costUsd,
        model,
        backend: backendOverride,
      })
      logger.info(`\n${benchStr}`)
      await messenger.reply(chatId, benchStr).catch(e => {
        logger.debug(`benchmark reply failed: ${getErrorMessage(e)}`)
      })
    }

    // Detect and send images from response
    await sendDetectedImages(chatId, response, messenger)

    // Fire-and-forget: extract memories from conversation periodically (only when extraction enabled)
    if (config.memory.chatMemory.enabled) {
      const keywordTriggered = triggerChatMemoryExtraction(chatId, effectiveText, response, platform)
      if (keywordTriggered) {
        await messenger.reply(chatId, '💾 已记录到记忆中').catch(e => logger.debug(`Memory reply failed: ${e}`))
      }
    }

    // Track conversation turn for episodic memory (idle timeout + explicit end detection)
    trackEpisodeTurn(chatId, effectiveText, response, platform)
  } catch (error) {
    clearLongRunningTimers()
    // Clean up controller reference on error
    if (activeControllers.get(chatId) === abortController) {
      activeControllers.delete(chatId)
    }

    // If aborted, just stop silently
    if (signal.aborted) {
      logger.info(`🛑 AI call aborted [${chatId.slice(0, 8)}]`)
      stopStreaming()
      if (placeholderId) {
        await messenger.editMessage(chatId, placeholderId, '⚡ 已中断，处理新消息...').catch(e => logger.debug(`Edit placeholder failed: ${e}`))
      }
      return
    }

    const msg = formatErrorMessage(error)
    logger.error(`chat error [${chatId.slice(0, 8)}]: ${msg}`)
    const errorMsg = `❌ 处理失败: ${msg}`
    if (placeholderId) {
      await messenger.editMessage(chatId, placeholderId, errorMsg).catch(e => {
        logger.debug(`error edit failed: ${getErrorMessage(e)}`)
      })
    } else {
      await messenger.reply(chatId, errorMsg)
    }
  }
}
