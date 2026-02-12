/**
 * Streaming response handling
 * Throttled message editing and long message splitting
 */

import { createLogger } from '../../shared/logger.js'
import type { MessengerAdapter } from './types.js'

const logger = createLogger('streaming-handler')

const STREAM_THROTTLE_MS = 1500
const STREAM_MIN_DELTA = 100 // chars
const DEFAULT_MAX_LENGTH = 4096

/**
 * Create a streaming chunk handler that throttles edits to a placeholder message.
 * Returns { onChunk, getAccumulated } — onChunk is undefined if no placeholderId.
 */
export function createStreamHandler(
  chatId: string,
  placeholderIdRef: { placeholderId: string | null },
  maxLen: number,
  messenger: MessengerAdapter,
  bench: { firstChunk: number }
): { onChunk: ((chunk: string) => void) | undefined; getAccumulated: () => string } {
  let accumulated = ''
  let lastEditAt = 0
  let lastEditLength = 0
  let isFirstChunk = true

  const onChunk = (chunk: string) => {
    accumulated += chunk
    if (!bench.firstChunk) bench.firstChunk = Date.now()

    const placeholderId = placeholderIdRef.placeholderId
    if (!placeholderId) return

    const now = Date.now()
    const deltaLen = accumulated.length - lastEditLength

    // First chunk: push immediately (no throttle) with streaming indicator
    if (isFirstChunk) {
      isFirstChunk = false
      lastEditAt = now
      lastEditLength = accumulated.length
      messenger.editMessage(chatId, placeholderId, accumulated + ' ⏳').catch(e => {
        logger.debug(`first chunk push failed: ${e instanceof Error ? e.message : e}`)
      })
      return
    }

    // Subsequent chunks: throttle (1.5s interval + 100 char delta)
    if (now - lastEditAt > STREAM_THROTTLE_MS && deltaLen > STREAM_MIN_DELTA) {
      lastEditAt = now
      lastEditLength = accumulated.length
      const preview =
        accumulated.length > maxLen
          ? accumulated.slice(0, maxLen - 20) + '\n\n... (输出中) ⏳'
          : accumulated + ' ⏳'
      messenger.editMessage(chatId, placeholderId, preview).catch(e => {
        logger.debug(`stream edit failed: ${e instanceof Error ? e.message : e}`)
      })
    }
  }

  return { onChunk, getAccumulated: () => accumulated }
}

/** Split long message into parts, breaking at newlines when possible */
export function splitMessage(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text]
  const parts: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining)
      break
    }
    // Try to break at newline
    let cutAt = remaining.lastIndexOf('\n', maxLength)
    if (cutAt < maxLength * 0.3) {
      // Newline too early, hard cut
      cutAt = maxLength
    }
    parts.push(remaining.slice(0, cutAt))
    remaining = remaining.slice(cutAt)
  }
  return parts
}

/**
 * Send final response: replace placeholder with first part, send rest as new messages.
 */
export async function sendFinalResponse(
  chatId: string,
  response: string,
  maxLen: number,
  placeholderId: string | null,
  messenger: MessengerAdapter
): Promise<void> {
  const parts = splitMessage(response, maxLen)
  if (placeholderId && parts.length > 0) {
    await messenger.editMessage(chatId, placeholderId, parts[0]!)
    for (const part of parts.slice(1)) {
      await messenger.reply(chatId, part)
    }
  } else {
    for (const part of parts) {
      await messenger.reply(chatId, part)
    }
  }
}
