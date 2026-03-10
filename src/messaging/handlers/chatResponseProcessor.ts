/**
 * Chat response processing — handle success results, errors, interruptions, side-effects
 */

import { existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { loadConfig } from '../../config/loadConfig.js'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { logConversation } from '../../store/conversationLog.js'
import { addMemory } from '../../memory/index.js'
import { sendFinalResponse } from './streamingHandler.js'
import { sendDetectedImages } from './imageExtractor.js'
import { triggerChatMemoryExtraction } from './chatMemoryExtractor.js'
import { trackEpisodeTurn } from './episodeExtractor.js'
import { setSession, incrementTurn } from './sessionManager.js'
import { createBenchmark, formatBenchmark, isBenchmarkEnabled } from './chatBenchmark.js'
import type { MessengerAdapter } from './types.js'

const logger = createLogger('chat-response')

export interface PostResponseContext {
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

/** Notify user that their request was interrupted by a newer message */
export async function notifyInterrupted(
  chatId: string,
  placeholderId: string | null,
  messenger: MessengerAdapter,
  partialContent?: string
): Promise<void> {
  if (placeholderId) {
    const suffix = '已中断，处理新消息...'
    const content = partialContent ? `${partialContent}\n\n${suffix}` : suffix
    await messenger
      .editMessage(chatId, placeholderId, content)
      .catch(e => logger.debug(`Edit placeholder failed: ${e}`))
  }
}

/** Send error message to user — edit placeholder if available, otherwise reply */
export async function sendErrorToUser(
  chatId: string,
  placeholderId: string | null,
  messenger: MessengerAdapter,
  msg: string
): Promise<void> {
  const errorMsg = `❌ ${msg}`
  if (placeholderId) {
    const ok = await messenger.editMessage(chatId, placeholderId, errorMsg)
    if (!ok) await messenger.reply(chatId, errorMsg)
  } else {
    await messenger.reply(chatId, errorMsg)
  }
}

/** Send MCP-generated images (e.g. screenshots) to user */
export async function sendMcpImages(
  chatId: string,
  mcpImagePaths: string[],
  messenger: MessengerAdapter
): Promise<void> {
  if (mcpImagePaths.length === 0 || !messenger.replyImage) return

  // Dedup: same file path should only be sent once
  const uniquePaths = [...new Set(mcpImagePaths)]

  // Only allow images from temp directories (MCP screenshots are saved there)
  const allowedPrefixes = ['/tmp/', '/var/tmp/', tmpdir()].filter(Boolean)
  for (const imgPath of uniquePaths) {
    try {
      if (!allowedPrefixes.some(prefix => imgPath.startsWith(prefix))) {
        logger.warn(`Refusing to send non-temp MCP image: ${imgPath}`)
        continue
      }
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
export function recordBackendPreference(chatId: string, backend: string, text: string): void {
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

/** Handle successful backend result: log, update session, send response, side-effects */
export async function processSuccessResult(
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

  // Update session
  if (newSessionId) setSession(chatId, newSessionId, backendOverride)
  incrementTurn(chatId, text, response)

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
