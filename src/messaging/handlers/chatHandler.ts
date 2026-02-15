/**
 * Chat handler — thin coordination layer
 * Routes text messages to AI backend with session management, streaming, and image detection
 */

import { invokeBackend } from '../../backend/index.js'
import { loadConfig } from '../../config/loadConfig.js'
import { createLogger } from '../../shared/logger.js'
import { formatErrorMessage } from '../../shared/formatErrorMessage.js'
import { buildClientPrompt } from '../../prompts/chatPrompts.js'
import { logConversation, getRecentConversations } from './conversationLog.js'
import { getSession, setSession, clearSession, enqueueChat, destroySessions, getModelOverride, getBackendOverride, shouldResetSession, incrementTurn } from './sessionManager.js'
import { createStreamHandler, sendFinalResponse } from './streamingHandler.js'
import { sendDetectedImages } from './imageExtractor.js'
import { getRegisteredBackends } from '../../backend/resolveBackend.js'
import type { MessengerAdapter, ClientContext } from './types.js'

const logger = createLogger('chat-handler')

const DEFAULT_MAX_LENGTH = 4096

// ── Model Selection ──

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
 */
export async function handleChat(
  chatId: string,
  text: string,
  messenger: MessengerAdapter,
  options?: ChatOptions
): Promise<void> {
  return enqueueChat(chatId, () =>
    handleChatInternal(chatId, text, messenger, options).catch(e => {
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`chat queue error [${chatId.slice(0, 8)}]: ${msg}`)
      messenger.reply(chatId, `❌ 处理失败: ${msg}`).catch(re => {
        logger.debug(`Failed to send error reply: ${re instanceof Error ? re.message : String(re)}`)
      })
    })
  )
}

/**
 * Clear the session for a chatId.
 */
export function clearChatSession(chatId: string): boolean {
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
  destroySessions()
}

// ── Internal ──

/** Parse backend override from message text (e.g. "@iflow question" or "/use opencode\nquestion") */
export function parseBackendOverride(text: string): { backend?: string; actualText: string } {
  const backends = getRegisteredBackends()
  const pattern = new RegExp(`^[@/](?:backend:|use\\s+)?(${backends.join('|')})(?:\\s|\\n)`, 's')
  const match = text.match(pattern)
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

  // Strip Lark mention placeholders (@_user_1 etc.) before parsing backend override
  const mentionCleaned = text.replace(/@_\w+/g, '').trim()
  // Parse backend override from message (inline directive like @iflow or /use opencode)
  const { backend: inlineBackend, actualText } = parseBackendOverride(mentionCleaned)
  const effectiveText = actualText || mentionCleaned

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

  // Build prompt with client context and optional images
  const hasImages = !!options?.images?.length
  const clientPrefix = options?.client ? buildClientPrompt(options.client) + '\n\n' : ''
  const images = options?.images

  // Inject minimal recent history for new sessions (session resume handles continuity)
  let historyContext = ''
  if (!sessionId) {
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

  let prompt = clientPrefix + historyContext + effectiveText
  if (images?.length) {
    const imagePart = images
      .map(p => `[用户发送了图片: ${p}，请使用 Read 工具查看这张图片并回复]`)
      .join('\n')
    prompt = prompt ? `${prompt}\n\n${imagePart}` : imagePart
  }

  // Model selection: user override > auto (haiku→sonnet→opus)
  const modelOverride = getModelOverride(chatId)
  const model = selectModel(effectiveText, { hasImages, modelOverride })
  bench.promptReady = Date.now()

  // Setup streaming with shared ref for placeholderId
  let placeholderId: string | null = null
  const streamHandlerState = { placeholderId: null as string | null }
  const { onChunk, stop: stopStreaming } = createStreamHandler(chatId, streamHandlerState, maxLen, messenger, bench)

  // Parallel: send placeholder + start backend call
  // Placeholder ID is injected as soon as it resolves (before backend finishes)
  const placeholder = hasImages ? '🖼️ 已收到图片，分析中...' : '🤔 思考中...'
  const placeholderPromise = messenger.sendAndGetId(chatId, placeholder).then(pId => {
    placeholderId = pId
    streamHandlerState.placeholderId = pId
    return pId
  })

  // Load config before parallel phase (cached — near-instant after daemon preload)
  const config = await loadConfig()
  const chatMcp = config.backend.chat?.mcpServers ?? []

  bench.parallelStart = Date.now()
  try {
    const [, result] = await Promise.all([
      placeholderPromise,
      invokeBackend({
        prompt,
        stream: true,
        skipPermissions: true,
        sessionId,
        onChunk,
        disableMcp: chatMcp.length === 0,
        mcpServers: chatMcp.length > 0 ? chatMcp : undefined,
        model,
        backendType: backendOverride, // Dynamic backend override
      }),
    ])
    bench.backendDone = Date.now()

    if (!result.ok) {
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

    // Log AI reply (with cost and model for aggregation)
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
    })

    // Update session
    if (newSessionId) {
      setSession(chatId, newSessionId)
    }

    // Track turn count and estimated tokens for auto-reset
    incrementTurn(chatId, text.length, response.length)

    // Append completion marker so user knows the response is final
    const elapsedSec = ((Date.now() - bench.start) / 1000).toFixed(1)
    const backendLabel = backendOverride ? ` [${backendOverride}]` : ''
    const completionMarker = `\n\n---\n✅ ${elapsedSec}s${backendLabel}`
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
        logger.debug(`benchmark reply failed: ${e instanceof Error ? e.message : e}`)
      })
    }

    // Detect and send images from response
    await sendDetectedImages(chatId, response, messenger)
  } catch (error) {
    const msg = formatErrorMessage(error)
    logger.error(`chat error [${chatId.slice(0, 8)}]: ${msg}`)
    const errorMsg = `❌ 处理失败: ${msg}`
    if (placeholderId) {
      await messenger.editMessage(chatId, placeholderId, errorMsg).catch(e => {
        logger.debug(`error edit failed: ${e instanceof Error ? e.message : e}`)
      })
    } else {
      await messenger.reply(chatId, errorMsg)
    }
  }
}
