/**
 * Streaming response handling
 * Throttled message editing and long message splitting
 */

import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { buildMarkdownCard } from '../larkCardWrapper.js'
import type { MessengerAdapter } from './types.js'

const logger = createLogger('streaming-handler')

const STREAM_THROTTLE_MS = 400
const STREAM_MIN_DELTA = 20 // chars
const DEFAULT_MAX_LENGTH = 4096

export interface StreamHandlerOptions {
  throttleMs?: number
  minDelta?: number
}

/**
 * Create a streaming chunk handler that throttles edits to a placeholder message.
 * Returns { onChunk, getAccumulated } — onChunk is undefined if no placeholderId.
 */
export function createStreamHandler(
  chatId: string,
  placeholderIdRef: { placeholderId: string | null },
  maxLen: number,
  messenger: MessengerAdapter,
  bench: { firstChunk: number },
  options?: StreamHandlerOptions,
): { onChunk: ((chunk: string) => void) | undefined; getAccumulated: () => string; stop: () => void; resetForNewTurn: () => void } {
  const throttleMs = options?.throttleMs ?? STREAM_THROTTLE_MS
  const minDelta = options?.minDelta ?? STREAM_MIN_DELTA
  let accumulated = ''
  let lastEditAt = 0
  let lastEditLength = 0
  let isFirstChunk = true
  let stopped = false
  // Sequence number prevents out-of-order edits: each edit waits for the previous one
  let editChain: Promise<void> = Promise.resolve()

  function scheduleEdit(text: string, placeholderId: string): void {
    editChain = editChain
      .then(async () => {
        await messenger.editMessage(chatId, placeholderId, text)
      })
      .catch((err) => {
        logger.debug(`streaming edit failed: ${getErrorMessage(err)}`)
      })
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

    // Subsequent chunks: throttle-based or paragraph-break trigger
    const newContent = accumulated.slice(lastEditLength)
    const hasParagraphBreak = newContent.includes('\n\n')
    const timeOk = now - lastEditAt > throttleMs
    const shouldUpdate =
      (timeOk && deltaLen > minDelta) ||
      (hasParagraphBreak && deltaLen > minDelta * 4 && now - lastEditAt > throttleMs * 0.4)

    if (shouldUpdate) {
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
    stop: async () => {
      stopped = true
      // Final flush: push remaining accumulated content (without ⏳) if there's unsent text
      const placeholderId = placeholderIdRef.placeholderId
      if (placeholderId && accumulated.length > lastEditLength) {
        const preview = accumulated.length > maxLen
          ? accumulated.slice(0, maxLen - 20) + '\n\n... (输出中)'
          : accumulated
        scheduleEdit(preview, placeholderId)
      }
      // Wait for all pending edits to complete
      await editChain
    },
    /** Reset accumulated text when a new assistant turn starts (after tool use) */
    resetForNewTurn: () => {
      accumulated = ''
      lastEditLength = 0
      isFirstChunk = true
    },
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

/** Detect if text contains markdown tables (pipe rows with separator line), ignoring fenced code blocks */
function hasMarkdownTable(text: string): boolean {
  const stripped = text.replace(/```[\s\S]*?```/g, '')
  return /^\|.+\|$/m.test(stripped) && /^\|[\s\-:|]+\|$/m.test(stripped)
}

/**
 * Send final response: replace placeholder with first part, send rest as new messages.
 * If the response contains markdown tables and the adapter supports cards,
 * delete the streaming placeholder and send a JSON 2.0 card instead.
 */
export async function sendFinalResponse(
  chatId: string,
  response: string,
  maxLen: number,
  placeholderId: string | null,
  messenger: MessengerAdapter
): Promise<void> {
  // Table → card upgrade: send card first, then delete streaming placeholder
  if (
    hasMarkdownTable(response) &&
    placeholderId &&
    messenger.deleteMessage &&
    messenger.sendCard
  ) {
    try {
      const cardJson = buildMarkdownCard(response)
      const cardMsgId = await messenger.sendCard(chatId, cardJson)
      if (cardMsgId) {
        // Card sent successfully — now safe to delete placeholder
        await messenger.deleteMessage(chatId, placeholderId).catch((err) => {
          logger.debug(`failed to delete streaming placeholder: ${getErrorMessage(err)}`)
        })
        return
      }
      // Card send returned falsy — keep placeholder for normal edit path below
    } catch (err) {
      logger.warn(`table card upgrade failed, fallback to post: ${getErrorMessage(err)}`)
      // Card failed — placeholder still exists, fall through to normal edit path
    }
  }

  const parts = splitMessage(response, maxLen)

  // Add continuation marker to non-last parts so the reader knows more follows
  const markedParts = parts.map((part, i) =>
    i < parts.length - 1 ? part + '\n\n*…（接下条）*' : part
  )

  if (placeholderId && markedParts.length > 0) {
    let editOk = await messenger.editMessage(chatId, placeholderId, markedParts[0]!)
    if (!editOk) {
      // Retry once after delay — Lark may rate-limit if streaming edit was too recent
      await new Promise(r => setTimeout(r, 500))
      editOk = await messenger.editMessage(chatId, placeholderId, markedParts[0]!)
      if (!editOk) {
        // Edit failed twice — try delete + reply, but only reply if delete succeeds
        logger.warn('final edit failed after retry, attempting delete + reply')
        const deleted = await messenger.deleteMessage?.(chatId, placeholderId).then(() => true).catch(() => false)
        if (deleted) {
          await messenger.reply(chatId, markedParts[0]!)
        }
      }
    }
    for (const part of markedParts.slice(1)) {
      await messenger.reply(chatId, part)
    }
  } else {
    for (const part of markedParts) {
      await messenger.reply(chatId, part)
    }
  }
}
