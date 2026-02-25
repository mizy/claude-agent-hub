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
import { logAIResponse, logConversationEvent } from '../conversationLogger.js'
import {
  getSession,
  setSession,
  clearSession,
  enqueueChat,
  destroySessions,
  getModelOverride,
  getBackendOverride,
  shouldResetSession,
  incrementTurn,
} from './sessionManager.js'
import { createStreamHandler, sendFinalResponse } from './streamingHandler.js'
import { sendDetectedImages } from './imageExtractor.js'
import { triggerChatMemoryExtraction } from './chatMemoryExtractor.js'
import { trackEpisodeTurn, destroyEpisodeTrackers, flushEpisode } from './episodeExtractor.js'
import { retrieveAllMemoryContext, addMemory } from '../../memory/index.js'
import type { MessengerAdapter, ClientContext } from './types.js'

// Re-export extracted modules for backward compatibility
export { parseInlineModel } from './selectModel.js'
export { toggleBenchmark, isBenchmarkEnabled } from './chatBenchmark.js'
export { parseBackendOverride } from './parseBackendOverride.js'

import { isClaudeModelBackend, selectModel, parseInlineModel } from './selectModel.js'
import {
  createBenchmark,
  formatBenchmark,
  isBenchmarkEnabled,
} from './chatBenchmark.js'
import { parseBackendOverride } from './parseBackendOverride.js'

const logger = createLogger('chat-handler')

const DEFAULT_MAX_LENGTH = 4096

// Per-chatId AbortController for interrupting active AI calls
const activeControllers = new Map<string, AbortController>()

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

// ── Helpers ──

/** Notify user that their request was interrupted by a newer message */
async function notifyInterrupted(
  chatId: string,
  placeholderId: string | null,
  messenger: MessengerAdapter
): Promise<void> {
  if (placeholderId) {
    await messenger
      .editMessage(chatId, placeholderId, '⚡ 已中断，处理新消息...')
      .catch(e => logger.debug(`Edit placeholder failed: ${e}`))
  }
}

/** Send error message to user — edit placeholder if available, otherwise reply */
async function sendErrorToUser(
  chatId: string,
  placeholderId: string | null,
  messenger: MessengerAdapter,
  msg: string
): Promise<void> {
  const errorMsg = `❌ ${msg}`
  if (placeholderId) {
    await messenger.editMessage(chatId, placeholderId, errorMsg).catch(e => {
      logger.debug(`error edit failed: ${getErrorMessage(e)}`)
    })
  } else {
    await messenger.reply(chatId, errorMsg)
  }
}

/** Send MCP-generated images (e.g. screenshots) to user */
async function sendMcpImages(
  chatId: string,
  mcpImagePaths: string[],
  messenger: MessengerAdapter
): Promise<void> {
  if (mcpImagePaths.length === 0 || !messenger.replyImage) return
  const { readFileSync, existsSync } = await import('fs')
  for (const imgPath of mcpImagePaths) {
    try {
      if (!existsSync(imgPath)) {
        logger.warn(`MCP image not found: ${imgPath}`)
        continue
      }
      const imageData = readFileSync(imgPath)
      logger.debug(`Sending MCP image (${imageData.length} bytes): ${imgPath}`)
      await messenger.replyImage(chatId, imageData, imgPath)
      logger.debug(`✓ MCP image sent: ${imgPath}`)
    } catch (e) {
      logger.error(`✗ Failed to send MCP image ${imgPath}: ${getErrorMessage(e)}`)
    }
  }
}

/** Record inline backend switch as user preference memory */
function recordBackendPreference(chatId: string, backend: string, text: string): void {
  try {
    const topic = text.length > 50 ? text.slice(0, 47) + '...' : text
    addMemory(
      `用户在讨论 "${topic}" 时选择使用 ${backend} backend`,
      'preference',
      { type: 'chat', chatId },
      { keywords: ['backend', backend, 'preference'], confidence: 0.7 }
    )
    logger.debug(`记录 backend 偏好: ${backend} [${chatId.slice(0, 8)}]`)
  } catch (e) {
    logger.debug(`Failed to record backend preference: ${getErrorMessage(e)}`)
  }
}

// ── Internal ──

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
  const { model: inlineModel, actualText: textAfterModel } = parseInlineModel(
    actualText || mentionCleaned
  )
  const effectiveText = textAfterModel || actualText || mentionCleaned

  // Early return for empty messages (avoid wasting API calls)
  if (!effectiveText && !options?.images?.length) {
    logger.info(`⊘ empty message skipped [${chatId.slice(0, 8)}]`)
    return
  }

  // Auto-reset session if turn/token limits exceeded
  const sessionWasReset = shouldResetSession(chatId)
  if (sessionWasReset) {
    clearSession(chatId)
    logger.info(`♻️ session auto-reset [${chatId.slice(0, 8)}]`)
    logConversationEvent('会话自动重置', `chatId: ${chatId.slice(0, 8)}`)
    // Notify user so they know context was lost
    messenger
      .reply(chatId, '♻️ 对话轮次已满，自动开启新会话')
      .catch(e => logger.debug(`reset notify failed: ${getErrorMessage(e)}`))
  }

  const session = getSession(chatId)
  const sessionId = session?.sessionId

  // Backend priority: inline message directive > session /backend override > config default
  const sessionBackend = getBackendOverride(chatId)
  const backendOverride = inlineBackend ?? sessionBackend
  logger.info(`💬 chat ${sessionId ? 'continue' : 'new'} [${chatId.slice(0, 8)}]`)
  if (!sessionId) {
    logConversationEvent(
      '新会话开始',
      `chatId: ${chatId.slice(0, 8)}${backendOverride ? `, backend: ${backendOverride}` : ''}`
    )
  }

  // Record backend switch as a user preference memory
  if (inlineBackend && effectiveText) {
    recordBackendPreference(chatId, inlineBackend, effectiveText)
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

  // Detect backend change — needed for history injection and session reuse decisions
  const currentBackend = backendOverride ?? 'default'
  // Normalize: undefined/missing sessionBackendType means 'default' (backward compat with old sessions)
  const previousBackend = session?.sessionBackendType ?? 'default'
  const backendChanged = !!(sessionId && previousBackend !== currentBackend)
  if (backendChanged) {
    logger.info(`🔄 session backend changed, starting new session`)
    logConversationEvent('后端切换', `${previousBackend} → ${currentBackend}`)
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

  // Retrieve relevant memories (only for new sessions — existing sessions have full history)
  let memoryContext = ''
  if (effectiveText && willStartNewSession) {
    try {
      const context = await retrieveAllMemoryContext(effectiveText, {
        maxResults: config.memory.chatMemory.maxMemories,
      })
      if (context) {
        memoryContext = context + '\n\n'
        logger.debug(
          `injected memory context (${context.length} chars) for chat [${chatId.slice(0, 8)}]`
        )
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

  // Model: inline keyword > session override > auto; only auto-select for Claude-compatible backends
  const modelOverride = inlineModel ?? getModelOverride(chatId)
  // Resolve actual backend type: config named backend → its type, else treat as type name directly
  const resolvedBackendType = backendOverride
    ? config.backends[backendOverride]?.type ?? backendOverride
    : config.backends[config.defaultBackend]?.type ?? 'claude-code'
  const isClaudeBackend = isClaudeModelBackend(resolvedBackendType)
  // Explicit model override (inline keyword or /model command) is always passed through;
  // auto-selection (selectModel) only applies to Claude-compatible backends
  const model = modelOverride
    ? modelOverride
    : isClaudeBackend
      ? selectModel(effectiveText, { hasImages })
      : undefined
  bench.promptReady = Date.now()

  // Setup streaming with shared ref for placeholderId
  let placeholderId: string | null = null
  const streamHandlerState = { placeholderId: null as string | null }
  const { onChunk, stop: stopStreaming } = createStreamHandler(
    chatId,
    streamHandlerState,
    maxLen,
    messenger,
    bench
  )

  // Auto-stop streaming when aborted
  signal.addEventListener('abort', () => stopStreaming(), { once: true })

  // Send placeholder (parallel with backend call)
  const placeholder = hasImages ? '🖼️ 已收到图片，分析中...' : '🤔 思考中...'
  const placeholderPromise = messenger
    .sendAndGetId(chatId, placeholder)
    .then(pId => {
      placeholderId = pId
      streamHandlerState.placeholderId = pId
      return pId
    })
    .catch(e => {
      // Placeholder failure is non-critical — streaming edits won't work but final reply still sends
      logger.debug(`placeholder send failed: ${getErrorMessage(e)}`)
      return null
    })

  const chatMcp = config.backends[config.defaultBackend]?.chat?.mcpServers ?? []

  bench.parallelStart = Date.now()

  try {
    const effectiveSessionId = inlineBackend || backendChanged ? undefined : sessionId
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
    bench.backendDone = Date.now()

    // Clean up controller reference (this turn is done)
    if (activeControllers.get(chatId) === abortController) {
      activeControllers.delete(chatId)
    }

    if (!result.ok) {
      if (result.error.type === 'cancelled') {
        logger.info(`🛑 AI call cancelled [${chatId.slice(0, 8)}], new message takes over`)
        stopStreaming()
        await notifyInterrupted(chatId, placeholderId, messenger)
        return
      }
      await sendErrorToUser(chatId, placeholderId, messenger, `AI 调用失败: ${result.error.message}`)
      return
    }

    const response = result.value.response
    const mcpImagePaths = result.value.mcpImagePaths ?? []
    const newSessionId = result.value.sessionId
    const durationMs = Date.now() - bench.start
    logger.info(`→ reply ${response.length} chars (${(durationMs / 1000).toFixed(1)}s)`)

    // Log AI reply (JSONL for aggregation + human-readable conversation log)
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
    logAIResponse(response, durationMs)

    // Update session (track which backend created it for cross-backend detection)
    if (newSessionId) {
      setSession(chatId, newSessionId, backendOverride)
    }

    // Track turn count and estimated tokens for auto-reset
    incrementTurn(chatId, text.length, response.length)

    // Append completion marker so user knows the response is final
    const elapsedSec = ((Date.now() - bench.start) / 1000).toFixed(1)
    const backendType = backendOverride ?? config.defaultBackend ?? 'claude-code'
    const modelLabel = model ? ` (${model})` : ''
    const completionMarker = `\n\n---\n⏱️ ${elapsedSec}s | ${backendType}${modelLabel}`
    const finalText = response + completionMarker

    // Stop streaming edits before sending final response to prevent race condition
    await stopStreaming()
    await sendFinalResponse(chatId, finalText, maxLen, placeholderId, messenger)
    bench.responseSent = Date.now()

    // Benchmark (log + send to user) only when enabled
    if (isBenchmarkEnabled()) {
      const benchStr = formatBenchmark(bench, {
        slotWaitMs: result.value.slotWaitMs,
        apiMs: result.value.durationApiMs,
        costUsd: result.value.costUsd,
        model,
        backend: backendOverride,
      })
      logger.debug(`\n${benchStr}`)
      await messenger.reply(chatId, benchStr).catch(e => {
        logger.debug(`benchmark reply failed: ${getErrorMessage(e)}`)
      })
    }

    // Send MCP-generated images (e.g. screenshots) directly via backend result
    await sendMcpImages(chatId, mcpImagePaths, messenger)

    // Detect and send images from response text (e.g. file paths mentioned by AI)
    await sendDetectedImages(chatId, response, messenger)

    // Extract memories from conversation periodically
    if (config.memory.chatMemory.enabled) {
      const keywordTriggered = triggerChatMemoryExtraction(chatId, effectiveText, response, platform)
      if (keywordTriggered) {
        await messenger
          .reply(chatId, '💾 已记录到记忆中')
          .catch(e => logger.debug(`Memory reply failed: ${e}`))
      }
    }

    // Track conversation turn for episodic memory (idle timeout + explicit end detection)
    trackEpisodeTurn(chatId, effectiveText, response, platform)
  } catch (error) {
    // Clean up controller reference on error
    if (activeControllers.get(chatId) === abortController) {
      activeControllers.delete(chatId)
    }

    // If aborted, just stop silently
    if (signal.aborted) {
      logger.info(`🛑 AI call aborted [${chatId.slice(0, 8)}]`)
      stopStreaming()
      await notifyInterrupted(chatId, placeholderId, messenger)
      return
    }

    const msg = formatErrorMessage(error)
    logger.error(`chat error [${chatId.slice(0, 8)}]: ${msg}`)
    await sendErrorToUser(chatId, placeholderId, messenger, `处理失败: ${msg}`)
  }
}
