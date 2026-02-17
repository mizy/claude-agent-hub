/**
 * Streaming response handling
 * Throttled message editing and long message splitting
 */

import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import type { MessengerAdapter } from './types.js'

const logger = createLogger('streaming-handler')

const STREAM_THROTTLE_MS = 800
const STREAM_MIN_DELTA = 50 // chars
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
): { onChunk: ((chunk: string) => void) | undefined; getAccumulated: () => string; stop: () => void } {
  let accumulated = ''
  let lastEditAt = 0
  let lastEditLength = 0
  let isFirstChunk = true
  let stopped = false
  // Sequence number prevents out-of-order edits: each edit waits for the previous one
  let editChain: Promise<void> = Promise.resolve()

  function scheduleEdit(text: string, placeholderId: string): void {
    editChain = editChain.then(() =>
      messenger.editMessage(chatId, placeholderId, text).catch(e => {
        logger.debug(`stream edit failed: ${getErrorMessage(e)}`)
      })
    )
  }

  const onChunk = (chunk: string) => {
    accumulated += chunk
    if (!bench.firstChunk) bench.firstChunk = Date.now()
    if (stopped) return

    const placeholderId = placeholderIdRef.placeholderId
    if (!placeholderId) return

    const now = Date.now()
    const deltaLen = accumulated.length - lastEditLength

    // First chunk: push immediately (no throttle) with streaming indicator
    if (isFirstChunk) {
      isFirstChunk = false
      lastEditAt = now
      lastEditLength = accumulated.length
      scheduleEdit(accumulated + ' ⏳', placeholderId)
      return
    }

    // Subsequent chunks: throttle (800ms interval + 50 char delta)
    if (now - lastEditAt > STREAM_THROTTLE_MS && deltaLen > STREAM_MIN_DELTA) {
      lastEditAt = now
      lastEditLength = accumulated.length
      const preview =
        accumulated.length > maxLen
          ? accumulated.slice(0, maxLen - 20) + '\n\n... (输出中) ⏳'
          : accumulated + ' ⏳'
      scheduleEdit(preview, placeholderId)
    }
  }

  return {
    onChunk,
    getAccumulated: () => accumulated,
    stop: () => { stopped = true },
  }
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
    // Try to break at newline within the allowed window
    let cutAt = remaining.lastIndexOf('\n', maxLength)
    if (cutAt <= 0 || cutAt < maxLength * 0.3) {
      // No suitable newline break, hard cut at maxLength
      cutAt = maxLength
    }
    parts.push(remaining.slice(0, cutAt))
    remaining = remaining.slice(cutAt)
    // Skip the newline character we split at
    if (remaining.startsWith('\n')) remaining = remaining.slice(1)
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
    try {
      await messenger.editMessage(chatId, placeholderId, parts[0]!)
    } catch (e) {
      // Placeholder edit failed — fall back to sending as new message
      logger.debug(`final edit failed, falling back to reply: ${getErrorMessage(e)}`)
      await messenger.reply(chatId, parts[0]!)
    }
    for (const part of parts.slice(1)) {
      await messenger.reply(chatId, part)
    }
  } else {
    for (const part of parts) {
      await messenger.reply(chatId, part)
    }
  }
}
