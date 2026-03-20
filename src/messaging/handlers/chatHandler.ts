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
import { flushEpisode, flushAllEpisodes, destroyEpisodeTrackers } from './episodeExtractor.js'
import { destroyGroupBuffer } from '../larkGroupBuffer.js'
import { createBenchmark } from './chatBenchmark.js'
import { recordEvent, registerSession, deregisterSession, updateSessionTopic, clearActiveSessions, flushInnerState } from '../../consciousness/index.js'
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

// Per-chatId active streaming context for graceful shutdown messaging
interface ActiveStreamCtx {
  messenger: MessengerAdapter
  getPlaceholderId: () => string | null
  getAccumulated: () => string
  cardKitInfo?: { cardId: string; elementId: string; getSequence: () => number }
}
const activeStreams = new Map<string, ActiveStreamCtx>()

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
 * New messages are queued and processed after the current one completes (no interruption).
 */
export async function handleChat(
  chatId: string,
  text: string,
  messenger: MessengerAdapter,
  options?: ChatOptions
): Promise<void> {
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
  try {
    deregisterSession(chatId)
    recordEvent('session_end', '会话主动清除')
  } catch (e) { logger.debug(`consciousness cleanup failed: ${getErrorMessage(e)}`) }
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
  // Send "进程已中断" to all active streaming chats before aborting
  const shutdownEdits: Promise<void>[] = []
  for (const [chatId, ctx] of activeStreams) {
    const placeholderId = ctx.getPlaceholderId()
    if (placeholderId) {
      const partial = ctx.getAccumulated()
      const content = partial
        ? `${partial}\n\n⚠️ 进程已中断，请重新发送消息`
        : '⚠️ 进程已中断，请重新发送消息'
      const ck = ctx.cardKitInfo
      if (ck && ctx.messenger.updateCardElement) {
        // CardKit path: update card element then close streaming mode
        shutdownEdits.push(
          ctx.messenger.updateCardElement(ck.cardId, ck.elementId, content, ck.getSequence())
            .then(ok => {
              if (ok) return ctx.messenger.closeStreamingCard?.(ck.cardId, content, ck.getSequence()).catch(() => {})
              // Fallback: delete card + reply
              return ctx.messenger.deleteMessage?.(chatId, placeholderId)
                .then(() => ctx.messenger.reply(chatId, content))
                .catch(() => {})
            })
            .then(() => {})
            .catch(e => logger.debug(`shutdown card update failed [${chatId.slice(0, 8)}]: ${e}`))
        )
      } else {
        // Legacy path: editMessage
        shutdownEdits.push(
          ctx.messenger.editMessage(chatId, placeholderId, content)
            .then(() => {})
            .catch(e => logger.debug(`shutdown edit failed [${chatId.slice(0, 8)}]: ${e}`))
        )
      }
    }
  }
  // Wait briefly for edits to land, then abort
  await Promise.allSettled(shutdownEdits)
  activeStreams.clear()

  for (const controller of activeControllers.values()) {
    controller.abort()
  }
  activeControllers.clear()
  clearChatMemoryBuffers()
  await destroyGroupBuffer()
  await flushAllEpisodes()
  destroyEpisodeTrackers()
  destroySessions()
  // Clear stale activeSessions from InnerState so next startup doesn't load expired sessions
  try {
    clearActiveSessions()
    flushInnerState()
  } catch { /* best effort */ }
}

// ── Session state resolution ──

interface SessionState {
  sessionId: string | undefined
  backendOverride: string | undefined
  backendChanged: boolean
  willStartNewSession: boolean
}

/** First-byte timeout for chat (60s) — detects network stalls without killing long tasks */
const CHAT_FIRST_BYTE_TIMEOUT_MS = 60 * 1000

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
    // Clear sessionId when backend changes - don't reuse old session with new backend
    sessionId = undefined
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

  // 3. Log user message + consciousness events
  logConversation({
    ts: new Date().toISOString(),
    dir: 'in',
    platform,
    chatId,
    sessionId: ss.sessionId,
    text: effectiveText || (options?.images?.length ? '[图片消息]' : ''),
    images: options?.images,
  })

  // Register session + record event in consciousness
  try {
    if (ss.willStartNewSession) {
      registerSession(chatId, platform)
      recordEvent('session_start', `新会话开始 (${platform})`)
    }
    updateSessionTopic(chatId, effectiveText || '')
    recordEvent('msg_in', effectiveText?.slice(0, 50) || '[非文本消息]')
  } catch (e) { logger.debug(`consciousness event recording failed: ${getErrorMessage(e)}`) }

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
  const stream = setupStreamingAndPlaceholder(chatId, hasImages, hasFiles, maxLen, messenger, bench, signal, streamOpts, platform)
  activeStreams.set(chatId, { messenger, getPlaceholderId: stream.getPlaceholderId, getAccumulated: stream.getAccumulated, get cardKitInfo() { return stream.cardKitInfo } })
  bench.parallelStart = Date.now()

  // Await placeholder creation before building prompt so phase status updates (🔍📝💭) are visible.
  // Serializing these is acceptable — placeholder creation (~100-300ms) overlaps with prior steps.
  await stream.placeholderPromise

  const { systemPrompt, prompt } = await buildFullPrompt(
    chatId, effectiveText, ss.willStartNewSession, options?.client, options?.images, config,
    { backend: backendName, model: model ?? config.backends[backendName]?.model },
    options?.files, 'full',
    ss.willStartNewSession ? (text) => stream.updateStatus(text) : undefined
  )
  bench.promptReady = Date.now()
  if (ss.willStartNewSession) stream.updateStatus('💭 等待 AI 响应...')

  // 6. Invoke backend
  // <think> tags streamed as-is for user feedback; stripped in final response by chatResponseProcessor
  try {
    const effectiveSessionId = inlineBackend ? undefined : ss.sessionId
    const [, result] = await Promise.all([
      stream.placeholderPromise,
      invokeBackend({
        prompt, systemPrompt, stream: true, skipPermissions: true,
        sessionId: effectiveSessionId, onChunk: stream.onChunk, onToolUse: stream.onToolUse,
        disableMcp: chatMcp.length === 0,
        mcpServers: chatMcp.length > 0 ? chatMcp : undefined,
        model, backendType: ss.backendOverride, signal,
        firstByteTimeoutMs: CHAT_FIRST_BYTE_TIMEOUT_MS,  // Detect network stalls
      }),
    ])
    bench.backendDone = Date.now()
    if (activeControllers.get(chatId) === abortController) activeControllers.delete(chatId)
    activeStreams.delete(chatId)

    if (!result.ok) {
      if (result.error.type === 'cancelled') {
        await stream.stopStreaming()
        await notifyInterrupted(chatId, stream.getPlaceholderId(), messenger, stream.getAccumulated(), stream.cardKitInfo)
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
      stream.stopStreaming, stream.getPlaceholderId(), maxLen, messenger, stream.cardKitInfo
    )
  } catch (error) {
    if (activeControllers.get(chatId) === abortController) activeControllers.delete(chatId)
    activeStreams.delete(chatId)
    if (signal.aborted) {
      await stream.stopStreaming()
      await notifyInterrupted(chatId, stream.getPlaceholderId(), messenger, stream.getAccumulated(), stream.cardKitInfo, '🛑 已中断')
      return
    }
    const msg = getErrorMessage(error)
    logger.error(`chat error [${chatId.slice(0, 8)}]: ${msg}`)
    await sendErrorToUser(chatId, stream.getPlaceholderId(), messenger, `处理失败: ${msg}`)
  }
}
