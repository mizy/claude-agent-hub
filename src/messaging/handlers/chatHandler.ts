/**
 * Chat handler — thin coordination layer
 * Routes text messages to AI backend with session management, streaming, and image detection
 */

import { invokeBackend } from '../../backend/index.js'
import { loadConfig } from '../../config/loadConfig.js'
import { createLogger } from '../../shared/logger.js'
import { formatErrorMessage } from '../../shared/formatErrorMessage.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { buildClientPrompt, wrapMemoryContext, wrapHistoryContext } from '../../prompts/chatPrompts.js'
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

// ── Internal: input parsing ──

interface ParsedInput {
  inlineBackend: string | undefined
  inlineModel: string | undefined
  effectiveText: string
}

/** Strip mentions, extract backend/model directives, return clean text */
async function parseMessageInput(text: string): Promise<ParsedInput> {
  const mentionCleaned = text.replace(/@_\w+/g, '').trim()
  const { backend: inlineBackend, actualText } = await parseBackendOverride(mentionCleaned)
  const { model: inlineModel, actualText: textAfterModel } = parseInlineModel(
    actualText || mentionCleaned
  )
  const effectiveText = textAfterModel || actualText || mentionCleaned
  return { inlineBackend, inlineModel, effectiveText }
}

// ── Internal: session context ──

interface SessionState {
  sessionId: string | undefined
  backendOverride: string | undefined
  backendChanged: boolean
  willStartNewSession: boolean
}

/** Resolve session: backend priority, change detection */
function resolveSessionState(
  chatId: string,
  inlineBackend: string | undefined,
  _messenger: MessengerAdapter
): SessionState {
  const session = getSession(chatId)
  const sessionId = session?.sessionId
  const sessionBackend = getBackendOverride(chatId)
  const backendOverride = inlineBackend ?? sessionBackend

  logger.info(`💬 chat ${sessionId ? 'continue' : 'new'} [${chatId.slice(0, 8)}]`)
  if (!sessionId) {
    logConversationEvent(
      '新会话开始',
      `chatId: ${chatId.slice(0, 8)}${backendOverride ? `, backend: ${backendOverride}` : ''}`
    )
  }

  // Detect backend change
  const currentBackend = backendOverride ?? 'default'
  const previousBackend = session?.sessionBackendType ?? 'default'
  const backendChanged = !!(sessionId && previousBackend !== currentBackend)
  if (backendChanged) {
    logger.info(`🔄 session backend changed, starting new session`)
    logConversationEvent('后端切换', `${previousBackend} → ${currentBackend}`)
    flushEpisode(chatId)
  }

  const willStartNewSession = !sessionId || !!inlineBackend || backendChanged
  return { sessionId, backendOverride, backendChanged, willStartNewSession }
}

// ── Internal: prompt assembly ──

/** Build full prompt: client context + memory + history + user text + images */
async function buildFullPrompt(
  chatId: string,
  effectiveText: string,
  willStartNewSession: boolean,
  client: ClientContext | undefined,
  images: string[] | undefined,
  config: Awaited<ReturnType<typeof loadConfig>>
): Promise<string> {
  const clientPrefix = client ? buildClientPrompt(client) + '\n\n' : ''

  // Inject recent history for new sessions
  let historyRaw = ''
  if (willStartNewSession) {
    const recent = getRecentConversations(chatId, 5)
    if (recent.length > 0) {
      historyRaw = recent
        .map(e => {
          const role = e.dir === 'in' ? '用户' : 'AI'
          const content = e.text.length > 200 ? e.text.slice(0, 197) + '...' : e.text
          return `[${role}] ${content}`
        })
        .join('\n')
    }
  }

  // Retrieve relevant memories for new sessions
  let memoryRaw = ''
  if (effectiveText && willStartNewSession) {
    try {
      const context = await retrieveAllMemoryContext(effectiveText, {
        maxResults: config.memory.chatMemory.maxMemories,
      })
      if (context) {
        memoryRaw = context
        logger.debug(`injected memory context (${context.length} chars) [${chatId.slice(0, 8)}]`)
      }
    } catch (e) {
      logger.debug(`memory retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Assemble: system context → memory → history → user message → images
  let prompt =
    clientPrefix + wrapMemoryContext(memoryRaw) + wrapHistoryContext(historyRaw) + effectiveText
  if (images?.length) {
    // Use →path← delimiters so ABSOLUTE_RE (lookbehind: \s|["'`(]) won't match
    // and imageExtractor won't re-send the user's original image in the response
    const imagePart = images
      .map(p => `[用户发送了图片，请使用 Read 工具查看后回复，路径→${p}←]`)
      .join('\n')
    prompt = prompt ? `${prompt}\n\n${imagePart}` : imagePart
  }
  return prompt
}

/** Resolve model: inline keyword > session override > auto-select (Claude only) */
function resolveModel(
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

// ── Internal: post-response processing ──

interface PostResponseContext {
  chatId: string
  text: string
  effectiveText: string
  platform: string
  sessionId: string | undefined
  backendOverride: string | undefined
  model: string | undefined
  config: Awaited<ReturnType<typeof loadConfig>>
  bench: ReturnType<typeof createBenchmark>
  userImages?: string[]
}

/** Handle successful backend result: log, update session, send response, side-effects */
async function processSuccessResult(
  ctx: PostResponseContext,
  result: { response: string; sessionId?: string; costUsd?: number; mcpImagePaths?: string[]; slotWaitMs?: number; durationApiMs?: number },
  stopStreaming: () => void | Promise<void>,
  placeholderId: string | null,
  maxLen: number,
  messenger: MessengerAdapter
): Promise<void> {
  const { chatId, text, effectiveText, platform, sessionId, backendOverride, model, config, bench } = ctx
  const { response, mcpImagePaths = [], sessionId: newSessionId } = result
  const durationMs = Date.now() - bench.start
  logger.info(`→ reply ${response.length} chars (${(durationMs / 1000).toFixed(1)}s)`)

  // Log AI reply
  logConversation({
    ts: new Date().toISOString(),
    dir: 'out',
    platform,
    chatId,
    sessionId: newSessionId ?? sessionId,
    text: response,
    durationMs,
    costUsd: result.costUsd,
    model,
    backendType: backendOverride,
  })
  logAIResponse(response, durationMs)

  // Update session
  if (newSessionId) setSession(chatId, newSessionId, backendOverride)
  incrementTurn(chatId, text.length, response.length)

  // Build and send final response with completion marker
  const elapsedSec = ((Date.now() - bench.start) / 1000).toFixed(1)
  const backendName = backendOverride ?? config.defaultBackend ?? 'claude-code'
  const configModel = config.backends[backendName]?.model
  const displayModel = model ?? configModel
  const modelLabel = displayModel ? ` (${displayModel})` : ''
  const finalText = response + `\n\n⏱️ ${elapsedSec}s | ${backendName}${modelLabel}`

  await stopStreaming()
  await sendFinalResponse(chatId, finalText, maxLen, placeholderId, messenger)
  bench.responseSent = Date.now()

  // Benchmark
  if (isBenchmarkEnabled()) {
    const benchStr = formatBenchmark(bench, {
      slotWaitMs: result.slotWaitMs,
      apiMs: result.durationApiMs,
      costUsd: result.costUsd,
      model,
      backend: backendOverride,
    })
    logger.debug(`\n${benchStr}`)
    await messenger.reply(chatId, benchStr).catch(e => {
      logger.debug(`benchmark reply failed: ${getErrorMessage(e)}`)
    })
  }

  // Images: MCP-generated + detected from response text (exclude user-sent images)
  await sendMcpImages(chatId, mcpImagePaths, messenger)
  await sendDetectedImages(chatId, response, messenger, ctx.userImages)

  // Memory extraction
  if (config.memory.chatMemory.enabled) {
    const keywordTriggered = triggerChatMemoryExtraction(chatId, effectiveText, response, platform)
    if (keywordTriggered) {
      await messenger
        .reply(chatId, '💾 已记录到记忆中')
        .catch(e => logger.debug(`Memory reply failed: ${e}`))
    }
  }

  // Episodic memory tracking
  trackEpisodeTurn(chatId, effectiveText, response, platform)
}

// ── Internal: streaming setup ──

interface StreamSetup {
  onChunk: ((chunk: string) => void) | undefined
  stopStreaming: () => void | Promise<void>
  placeholderPromise: Promise<string | null>
  getPlaceholderId: () => string | null
}

/** Setup streaming handler and send placeholder message */
function setupStreamingAndPlaceholder(
  chatId: string,
  hasImages: boolean,
  maxLen: number,
  messenger: MessengerAdapter,
  bench: ReturnType<typeof createBenchmark>,
  signal: AbortSignal
): StreamSetup {
  let placeholderId: string | null = null
  const streamState = { placeholderId: null as string | null }
  const { onChunk, stop: stopStreaming } = createStreamHandler(
    chatId, streamState, maxLen, messenger, bench
  )
  signal.addEventListener('abort', () => stopStreaming(), { once: true })

  const placeholderPromise = messenger
    .sendAndGetId(chatId, hasImages ? '🖼️ 已收到图片，分析中...' : '🤔 思考中...')
    .then(pId => { placeholderId = pId; streamState.placeholderId = pId; return pId })
    .catch(e => { logger.debug(`placeholder send failed: ${getErrorMessage(e)}`); return null })

  return { onChunk, stopStreaming, placeholderPromise, getPlaceholderId: () => placeholderId }
}

// ── Internal: main orchestrator ──

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
  if (!effectiveText && !options?.images?.length) {
    logger.info(`⊘ empty message skipped [${chatId.slice(0, 8)}]`)
    return
  }

  // 2. Resolve session context
  const ss = resolveSessionState(chatId, inlineBackend, messenger)
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

  // 4. Build prompt and resolve model
  const config = await loadConfig()
  const hasImages = !!options?.images?.length
  const prompt = await buildFullPrompt(
    chatId, effectiveText, ss.willStartNewSession, options?.client, options?.images, config
  )
  const model = resolveModel(
    effectiveText, hasImages, inlineModel, chatId, ss.backendOverride, config
  )
  bench.promptReady = Date.now()

  // 5. Setup streaming + placeholder
  const stream = setupStreamingAndPlaceholder(chatId, hasImages, maxLen, messenger, bench, signal)
  const chatMcp = config.backends[config.defaultBackend]?.chat?.mcpServers ?? []
  bench.parallelStart = Date.now()

  // 6. Invoke backend
  try {
    const effectiveSessionId = inlineBackend || ss.backendChanged ? undefined : ss.sessionId
    const [, result] = await Promise.all([
      stream.placeholderPromise,
      invokeBackend({
        prompt, stream: true, skipPermissions: true,
        sessionId: effectiveSessionId, onChunk: stream.onChunk,
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
        await notifyInterrupted(chatId, stream.getPlaceholderId(), messenger)
        return
      }
      // Session invalidated (e.g. backend restarted, session expired on backend side)
      // Clear our local session so next message starts fresh automatically
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
      await notifyInterrupted(chatId, stream.getPlaceholderId(), messenger)
      return
    }
    const msg = formatErrorMessage(error)
    logger.error(`chat error [${chatId.slice(0, 8)}]: ${msg}`)
    await sendErrorToUser(chatId, stream.getPlaceholderId(), messenger, `处理失败: ${msg}`)
  }
}
