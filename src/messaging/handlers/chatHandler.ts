/**
 * Chat handler — thin coordination layer
 * Routes text messages to AI backend with session management, streaming, and image detection
 */

import { invokeBackend } from '../../backend/index.js'
import { loadConfig } from '../../config/loadConfig.js'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { logConversation, logConversationEvent } from '../../store/conversationLog.js'
import {
  getSession,
  clearSession,
  enqueueChat,
  destroySessions,
  getBackendOverride,
} from './sessionManager.js'
import { clearChatMemoryBuffers } from './chatMemoryExtractor.js'
import { flushEpisode, destroyEpisodeTrackers } from './episodeExtractor.js'
import { destroyGroupBuffer } from '../larkEventRouter.js'
import { createBenchmark } from './chatBenchmark.js'
import type { MessengerAdapter, ClientContext } from './types.js'
import type { StreamHandlerOptions } from './streamingHandler.js'

// Re-export extracted modules for backward compatibility
export { parseInlineModel } from './selectModel.js'
export { toggleBenchmark, isBenchmarkEnabled } from './chatBenchmark.js'
export { parseBackendOverride } from './parseBackendOverride.js'

// Import from split modules
import { parseMessageInput } from './chatInputParser.js'
import { buildFullPrompt, resolveModel } from './chatPromptBuilder.js'
import { processSuccessResult, notifyInterrupted, sendErrorToUser, recordBackendPreference } from './chatResponseProcessor.js'
import { setupStreamingAndPlaceholder } from './chatStreamSetup.js'

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
  /** Optional non-image file paths (PDF, txt, xlsx etc.) from the user message */
  files?: string[]
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
 * Cancel the active AI call for a chatId (e.g. when SSE client disconnects).
 */
export function cancelActiveChat(chatId: string): void {
  const controller = activeControllers.get(chatId)
  if (controller) {
    logger.info(`⚡ cancelling active chat [${chatId.slice(0, 8)}] (client disconnect)`)
    controller.abort()
    activeControllers.delete(chatId)
  }
}

/**
 * Cleanup all sessions and stop timers. Call on daemon shutdown.
 */
export async function destroyChatHandler(): Promise<void> {
  for (const controller of activeControllers.values()) {
    controller.abort()
  }
  activeControllers.clear()
  clearChatMemoryBuffers()
  await destroyGroupBuffer()
  destroyEpisodeTrackers()
  destroySessions()
}

// ── Session state resolution ──

interface SessionState {
  sessionId: string | undefined
  backendOverride: string | undefined
  backendChanged: boolean
  willStartNewSession: boolean
}

/** Max turns before auto-rotating session to avoid bloated CLI context */
const SESSION_MAX_TURNS = 30

function resolveSessionState(
  chatId: string,
  inlineBackend: string | undefined,
): SessionState {
  const session = getSession(chatId)
  let sessionId = session?.sessionId
  const sessionBackend = getBackendOverride(chatId)
  const backendOverride = inlineBackend ?? sessionBackend

  logger.info(`💬 chat ${sessionId ? 'continue' : 'new'} [${chatId.slice(0, 8)}]`)
  if (!sessionId) {
    logConversationEvent(
      '新会话开始',
      `chatId: ${chatId.slice(0, 8)}${backendOverride ? `, backend: ${backendOverride}` : ''}`
    )
  }

  const currentBackend = backendOverride ?? 'default'
  const previousBackend = session?.sessionBackendType ?? 'default'
  const backendChanged = !!(sessionId && previousBackend !== currentBackend)
  if (backendChanged) {
    logger.info(`🔄 session backend changed, starting new session`)
    logConversationEvent('后端切换', `${previousBackend} → ${currentBackend}`)
    flushEpisode(chatId)
  }

  // Auto-rotate session when turn count exceeds threshold to prevent CLI context bloat
  const turnRotation = !!(sessionId && !backendChanged && session && session.turnCount >= SESSION_MAX_TURNS)
  if (turnRotation) {
    logger.info(`🔄 session auto-rotated after ${session.turnCount} turns [${chatId.slice(0, 8)}]`)
    logConversationEvent('会话自动轮换', `${session.turnCount} turns, 清理上下文`)
    flushEpisode(chatId)
    clearSession(chatId)
    sessionId = undefined
  }

  const willStartNewSession = !sessionId || backendChanged
  return { sessionId, backendOverride, backendChanged, willStartNewSession }
}

// ── Main orchestrator ──

async function handleChatInternal(
  chatId: string,
  text: string,
  messenger: MessengerAdapter,
  options?: ChatOptions
): Promise<void> {
  const maxLen = options?.maxMessageLength ?? DEFAULT_MAX_LENGTH
  const platform = options?.client?.platform ?? 'unknown'
  const bench = createBenchmark()
  const abortController = new AbortController()
  activeControllers.set(chatId, abortController)
  const { signal } = abortController

  // 1. Parse input
  const { inlineBackend, inlineModel, effectiveText } = await parseMessageInput(text)
  if (!effectiveText && !options?.images?.length && !options?.files?.length) {
    logger.info(`⊘ empty message skipped [${chatId.slice(0, 8)}]`)
    return
  }

  // 2. Resolve session context
  const ss = resolveSessionState(chatId, inlineBackend)
  if (inlineBackend && effectiveText) recordBackendPreference(chatId, inlineBackend, effectiveText)

  // 3. Log user message
  logConversation({
    ts: new Date().toISOString(),
    dir: 'in',
    platform,
    chatId,
    sessionId: ss.sessionId,
    text: effectiveText || (options?.images?.length ? '[图片消息]' : ''),
    images: options?.images,
  })

  // 4. Resolve config + model
  const config = await loadConfig()
  const hasImages = !!options?.images?.length
  const hasFiles = !!options?.files?.length
  const model = resolveModel(
    effectiveText, hasImages, inlineModel, chatId, ss.backendOverride, config
  )
  const backendName = ss.backendOverride ?? config.defaultBackend ?? 'claude-code'
  const chatMcp = config.backends[config.defaultBackend]?.chat?.mcpServers ?? []

  // 5. Setup streaming + placeholder — start before prompt build so placeholder appears sooner
  const streamOpts: StreamHandlerOptions | undefined =
    platform === 'Web' ? { throttleMs: 150, minDelta: 10 } : undefined
  const stream = setupStreamingAndPlaceholder(chatId, hasImages, hasFiles, maxLen, messenger, bench, signal, streamOpts)
  bench.parallelStart = Date.now()

  // Build prompt concurrently with placeholder send
  const prompt = await buildFullPrompt(
    chatId, effectiveText, ss.willStartNewSession, options?.client, options?.images, config,
    { backend: backendName, model: model ?? config.backends[backendName]?.model },
    options?.files
  )
  bench.promptReady = Date.now()

  // 6. Invoke backend
  try {
    const effectiveSessionId = inlineBackend || ss.backendChanged ? undefined : ss.sessionId
    const [, result] = await Promise.all([
      stream.placeholderPromise,
      invokeBackend({
        prompt, stream: true, skipPermissions: true,
        sessionId: effectiveSessionId, onChunk: stream.onChunk, onToolUse: stream.onToolUse,
        disableMcp: chatMcp.length === 0,
        mcpServers: chatMcp.length > 0 ? chatMcp : undefined,
        model, backendType: ss.backendOverride, signal,
      }),
    ])
    bench.backendDone = Date.now()
    if (activeControllers.get(chatId) === abortController) activeControllers.delete(chatId)

    if (!result.ok) {
      if (result.error.type === 'cancelled') {
        stream.stopStreaming()
        await notifyInterrupted(chatId, stream.getPlaceholderId(), messenger, stream.getAccumulated())
        return
      }
      const errMsg = result.error.message.toLowerCase()
      if (errMsg.includes('session') || errMsg.includes('conversation not found')) {
        clearSession(chatId)
        logger.info(`session invalidated, cleared [${chatId.slice(0, 8)}]: ${result.error.message}`)
        await sendErrorToUser(chatId, stream.getPlaceholderId(), messenger, '会话已失效，已自动清理 — 请重新发送消息')
        return
      }
      await sendErrorToUser(chatId, stream.getPlaceholderId(), messenger, `AI 调用失败: ${result.error.message}`)
      return
    }

    // 7. Process success
    await processSuccessResult(
      { chatId, text, effectiveText, platform, sessionId: ss.sessionId,
        backendOverride: ss.backendOverride, model, config, bench, userImages: options?.images },
      result.value,
      stream.stopStreaming, stream.getPlaceholderId(), maxLen, messenger
    )
  } catch (error) {
    if (activeControllers.get(chatId) === abortController) activeControllers.delete(chatId)
    if (signal.aborted) {
      stream.stopStreaming()
      await notifyInterrupted(chatId, stream.getPlaceholderId(), messenger, stream.getAccumulated())
      return
    }
    const msg = getErrorMessage(error)
    logger.error(`chat error [${chatId.slice(0, 8)}]: ${msg}`)
    await sendErrorToUser(chatId, stream.getPlaceholderId(), messenger, `处理失败: ${msg}`)
  }
}
