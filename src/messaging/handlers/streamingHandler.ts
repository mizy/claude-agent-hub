/**
 * Streaming response handling
 * Throttled message editing and long message splitting
 */

import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { buildMarkdownCard } from '../larkCardWrapper.js'
import type { MessengerAdapter } from './types.js'

const logger = createLogger('streaming-handler')

const STREAM_THROTTLE_MS = 1000
const STREAM_MIN_DELTA = 80 // chars — ~1s throttle accumulates more content per update
const DEFAULT_MAX_LENGTH = 4096

export interface StreamHandlerOptions {
  throttleMs?: number
  minDelta?: number
}

export interface StreamHandlerResult {
  onChunk: ((chunk: string) => void) | undefined
  getAccumulated: () => string
  stop: () => Promise<void>
  resetForNewTurn: () => void
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
): StreamHandlerResult {
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
      scheduleEdit(accumulated, placeholderId)
      return
    }

    // Subsequent chunks: throttle-based or paragraph-break trigger
    const newContent = accumulated.slice(lastEditLength)
    const hasParagraphBreak = newContent.includes('\n\n')
    const timeOk = now - lastEditAt > throttleMs
    const shouldUpdate =
      (timeOk && deltaLen > minDelta) ||
      (hasParagraphBreak && deltaLen > minDelta * 2 && now - lastEditAt > throttleMs * 0.6)

    if (shouldUpdate) {
      lastEditAt = now
      lastEditLength = accumulated.length
      const preview =
        accumulated.length > maxLen
          ? accumulated.slice(0, maxLen - 20) + '\n\n... (输出中)'
          : accumulated
      scheduleEdit(preview, placeholderId)
    }
  }

  return {
    onChunk,
    getAccumulated: () => accumulated,
    stop: async () => {
      stopped = true
      // Just wait for in-flight edits — do NOT flush remaining content here.
      // sendFinalResponse() immediately follows and will overwrite the placeholder
      // with the complete final text. A redundant pre-final edit here causes two
      // rapid edits in a row, which triggers Lark rate-limiting and the
      // delete + re-send fallback (visible to user as "撤回 + 重发").
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

/**
 * Create a CardKit v2 streaming handler.
 * Uses cardkit.v1.cardElement.content for typewriter-style updates (SDK does diff).
 * Falls back to createStreamHandler if card creation fails.
 */
// QPS limits are waived during streaming mode, so we can push frequently.
// Smaller, more frequent chunks give smoother typewriter effect on the client.
const CARDKIT_THROTTLE_MS = 200
const CARDKIT_MIN_DELTA = 5 // chars — avoid sending trivially small updates

export async function createCardStreamHandler(
  chatId: string,
  initialContent: string,
  maxLen: number,
  messenger: MessengerAdapter,
  bench: { firstChunk: number },
): Promise<{ handler: StreamHandlerResult; placeholderId: string | null; cardKitInfo?: { cardId: string; elementId: string; getSequence: () => number } }> {
  // Try to create a CardKit streaming card
  const cardInfo = await messenger.createStreamingCard?.(chatId, initialContent).catch((err) => {
    logger.warn(`CardKit card creation failed, falling back to editMessage: ${getErrorMessage(err)}`)
    return null
  })

  if (!cardInfo) {
    // Fallback: use the legacy editMessage-based stream handler
    const streamState = { placeholderId: null as string | null }
    const handler = createStreamHandler(chatId, streamState, maxLen, messenger, bench)
    const pId = await messenger.sendAndGetId(chatId, initialContent).catch(() => null)
    streamState.placeholderId = pId
    if (handler.onChunk && handler.getAccumulated().length > 0) handler.onChunk('')
    return { handler, placeholderId: pId }
  }

  const { cardId, elementId, messageId } = cardInfo
  let accumulated = ''
  let sequence = 0
  let stopped = false
  let lastUpdateAt = 0
  let lastEditLength = 0
  let isFirstChunk = true
  let updateChain: Promise<void> = Promise.resolve()

  function scheduleUpdate(content: string): void {
    const seq = ++sequence
    updateChain = updateChain
      .then(async () => {
        await messenger.updateCardElement!(cardId, elementId, content, seq)
      })
      .catch((err) => {
        logger.debug(`card element update failed (seq ${seq}): ${getErrorMessage(err)}`)
      })
  }

  function formatContent(): string {
    // CardKit typewriter requires old text to be a PREFIX of new text.
    return accumulated.length > maxLen
      ? accumulated.slice(0, maxLen - 20) + '\n\n... (输出中)'
      : accumulated
  }

  const onChunk = (chunk: string) => {
    accumulated += chunk
    if (!bench.firstChunk) bench.firstChunk = Date.now()
    if (stopped) return

    const now = Date.now()

    // First chunk: push immediately
    if (isFirstChunk) {
      isFirstChunk = false
      lastUpdateAt = now
      lastEditLength = accumulated.length
      scheduleUpdate(formatContent())
      return
    }

    // Time + min-delta throttle — frequent small updates for smooth typewriter
    const deltaLen = accumulated.length - lastEditLength
    if (now - lastUpdateAt >= CARDKIT_THROTTLE_MS && deltaLen >= CARDKIT_MIN_DELTA) {
      lastUpdateAt = now
      lastEditLength = accumulated.length
      scheduleUpdate(formatContent())
    }
  }

  const handler: StreamHandlerResult = {
    onChunk,
    getAccumulated: () => accumulated,
    stop: async () => {
      stopped = true
      // Do NOT flush remaining content here — sendFinalResponse() immediately
      // follows and sends the complete final text. A redundant pre-final update
      // wastes API quota and may hit rate limits.
      await updateChain
    },
    resetForNewTurn: () => {
      accumulated = ''
      lastEditLength = 0
      isFirstChunk = true
    },
  }

  return {
    handler,
    placeholderId: messageId,
    cardKitInfo: { cardId, elementId, getSequence: () => ++sequence },
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
  messenger: MessengerAdapter,
  cardKitInfo?: { cardId: string; elementId: string; getSequence: () => number },
): Promise<void> {
  // CardKit v2 path: update card element with final complete text
  if (cardKitInfo && messenger.updateCardElement) {
    const ok = await messenger.updateCardElement(
      cardKitInfo.cardId, cardKitInfo.elementId, response, cardKitInfo.getSequence(),
    ).catch((err) => {
      logger.warn(`CardKit final update failed: ${getErrorMessage(err)}`)
      return false
    })
    if (ok) {
      // Close streaming mode — stops typewriter animation, shows summary in card
      await messenger.closeStreamingCard?.(
        cardKitInfo.cardId, response, cardKitInfo.getSequence(),
      ).catch(e => logger.debug(`close streaming failed: ${getErrorMessage(e)}`))
      return
    }
    // Retry once
    logger.warn('CardKit final update failed, retrying...')
    const retryOk = await messenger.updateCardElement(
      cardKitInfo.cardId, cardKitInfo.elementId, response, cardKitInfo.getSequence(),
    ).catch(() => false)
    if (retryOk) {
      await messenger.closeStreamingCard?.(
        cardKitInfo.cardId, response, cardKitInfo.getSequence(),
      ).catch(e => logger.debug(`close streaming failed: ${getErrorMessage(e)}`))
      return
    }
    // CardKit completely failed — delete the card message and fall through to send a fresh reply
    logger.warn('CardKit final update retry failed, falling back to fresh reply')
    if (placeholderId && messenger.deleteMessage) {
      await messenger.deleteMessage(chatId, placeholderId).catch(() => {})
    }
    // Fall through to legacy send path below (placeholderId = null to force new message)
    placeholderId = null
  }
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
    // Wait briefly to avoid Lark rate-limit from the last streaming edit
    await new Promise(r => setTimeout(r, 300))
    let editOk = await messenger.editMessage(chatId, placeholderId, markedParts[0]!)
    if (!editOk) {
      // Retry once after delay — Lark may rate-limit if streaming edit was too recent
      await new Promise(r => setTimeout(r, 800))
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
