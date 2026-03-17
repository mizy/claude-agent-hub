/**
 * Chat streaming setup — create stream handler and send placeholder message
 */

import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { createStreamHandler, createCardStreamHandler, type StreamHandlerOptions } from './streamingHandler.js'
import { createBenchmark } from './chatBenchmark.js'
import type { MessengerAdapter } from './types.js'

const logger = createLogger('chat-stream-setup')

export interface CardKitInfo {
  cardId: string
  elementId: string
  getSequence: () => number
}

export interface StreamSetup {
  onChunk: ((chunk: string) => void) | undefined
  onToolUse: () => void
  stopStreaming: () => void | Promise<void>
  placeholderPromise: Promise<string | null>
  getPlaceholderId: () => string | null
  getAccumulated: () => string
  updateStatus: (text: string) => void
  cardKitInfo?: CardKitInfo
}

/** Setup streaming handler and send placeholder message */
export function setupStreamingAndPlaceholder(
  chatId: string,
  hasImages: boolean,
  hasFiles: boolean,
  maxLen: number,
  messenger: MessengerAdapter,
  bench: ReturnType<typeof createBenchmark>,
  signal: AbortSignal,
  streamOptions?: StreamHandlerOptions,
  platform?: string,
): StreamSetup {
  const placeholderText = hasImages ? '🖼️ 已收到图片，分析中...' : hasFiles ? '📎 已收到文件，分析中...' : '🤔 思考中...'
  const isLark = platform?.includes('Lark') || platform?.includes('飞书')
  const useCardKit = isLark && !!messenger.createStreamingCard && !!messenger.updateCardElement
  logger.info(`stream setup: platform=${platform} isLark=${isLark} useCardKit=${useCardKit}`)

  if (useCardKit) {
    return setupCardKitStream(chatId, placeholderText, maxLen, messenger, bench, signal)
  }
  return setupLegacyStream(chatId, placeholderText, maxLen, messenger, bench, signal, streamOptions)
}

/** CardKit v2 streaming — creates a card, then updates element content */
function setupCardKitStream(
  chatId: string,
  placeholderText: string,
  maxLen: number,
  messenger: MessengerAdapter,
  bench: ReturnType<typeof createBenchmark>,
  signal: AbortSignal,
): StreamSetup {
  let placeholderId: string | null = null
  let onChunk: ((chunk: string) => void) | undefined
  let stopStreaming: () => Promise<void> = async () => {}
  let getAccumulated: () => string = () => ''
  let resetForNewTurn: () => void = () => {}
  let cardKitInfoRef: CardKitInfo | undefined
  // Buffer chunks arriving before card creation completes
  const earlyChunks: string[] = []
  let ready = false
  // Buffer status updates that arrive before placeholder is ready
  let pendingStatus: string | null = null

  // Track abort during card creation — once: true means we must check after ready
  let aborted = false
  signal.addEventListener('abort', () => {
    aborted = true
    stopStreaming()
  }, { once: true })

  function applyStatus(text: string): void {
    if (getAccumulated().length > 0) return
    if (cardKitInfoRef) {
      messenger.updateCardElement?.(
        cardKitInfoRef.cardId, cardKitInfoRef.elementId, text, cardKitInfoRef.getSequence(),
      ).catch(e => logger.debug(`card status update failed: ${getErrorMessage(e)}`))
    } else if (placeholderId) {
      messenger.editMessage(chatId, placeholderId, text)
        .catch(e => logger.debug(`status update failed: ${getErrorMessage(e)}`))
    }
  }

  const placeholderPromise = createCardStreamHandler(
    chatId, placeholderText, maxLen, messenger, bench,
  ).then(({ handler, placeholderId: pId, cardKitInfo }) => {
    placeholderId = pId
    onChunk = handler.onChunk ?? undefined
    stopStreaming = handler.stop
    getAccumulated = handler.getAccumulated
    resetForNewTurn = handler.resetForNewTurn
    cardKitInfoRef = cardKitInfo
    ready = true
    // If abort fired during card creation, stop now and skip replay
    if (aborted || signal.aborted) {
      handler.stop()
      earlyChunks.length = 0
      return pId
    }
    // Apply buffered status update (if no content yet)
    if (pendingStatus) { applyStatus(pendingStatus); pendingStatus = null }
    // Replay buffered chunks
    if (onChunk && earlyChunks.length > 0) {
      onChunk(earlyChunks.join(''))
    }
    earlyChunks.length = 0
    return pId
  }).catch(e => {
    logger.warn(`CardKit setup failed, falling back to legacy: ${getErrorMessage(e)}`)
    const legacy = setupLegacyStream(chatId, placeholderText, maxLen, messenger, bench, signal)
    onChunk = legacy.onChunk
    stopStreaming = legacy.stopStreaming as () => Promise<void>
    getAccumulated = legacy.getAccumulated
    resetForNewTurn = legacy.onToolUse
    // Replay buffered chunks
    ready = true
    if (onChunk && earlyChunks.length > 0) {
      onChunk(earlyChunks.join(''))
    }
    earlyChunks.length = 0
    legacy.placeholderPromise.then(pId => {
      placeholderId = pId
      if (pendingStatus) { applyStatus(pendingStatus); pendingStatus = null }
    }).catch(() => {})
    return null
  })

  function updateStatus(text: string): void {
    if (getAccumulated().length > 0) return
    if (!placeholderId) {
      // Placeholder not yet created — buffer the latest status
      pendingStatus = text
      return
    }
    applyStatus(text)
  }

  return {
    onChunk: (chunk: string) => {
      if (!ready) { earlyChunks.push(chunk); return }
      onChunk?.(chunk)
    },
    onToolUse: () => resetForNewTurn(),
    stopStreaming: () => stopStreaming(),
    placeholderPromise,
    getPlaceholderId: () => placeholderId,
    getAccumulated: () => getAccumulated(),
    updateStatus,
    get cardKitInfo() { return cardKitInfoRef },
  }
}

/** Legacy editMessage-based streaming */
function setupLegacyStream(
  chatId: string,
  placeholderText: string,
  maxLen: number,
  messenger: MessengerAdapter,
  bench: ReturnType<typeof createBenchmark>,
  signal: AbortSignal,
  streamOptions?: StreamHandlerOptions,
): StreamSetup {
  let placeholderId: string | null = null
  let pendingStatus: string | null = null
  const streamState = { placeholderId: null as string | null }
  const { onChunk, stop: stopStreaming, getAccumulated, resetForNewTurn } = createStreamHandler(
    chatId, streamState, maxLen, messenger, bench, streamOptions
  )
  signal.addEventListener('abort', () => stopStreaming(), { once: true })

  const placeholderPromise = messenger
    .sendAndGetId(chatId, placeholderText)
    .then(pId => {
      placeholderId = pId
      streamState.placeholderId = pId
      if (pId && pendingStatus && getAccumulated().length === 0) {
        messenger.editMessage(chatId, pId, pendingStatus)
          .catch(e => logger.debug(`buffered status update failed: ${getErrorMessage(e)}`))
        pendingStatus = null
      }
      if (onChunk && getAccumulated().length > 0) onChunk('')
      return pId
    })
    .catch(e => { logger.debug(`placeholder send failed: ${getErrorMessage(e)}`); return null })

  function updateStatus(text: string): void {
    if (getAccumulated().length > 0) return
    if (!placeholderId) { pendingStatus = text; return }
    messenger.editMessage(chatId, placeholderId, text)
      .catch(e => logger.debug(`status update failed: ${getErrorMessage(e)}`))
  }

  return { onChunk, onToolUse: resetForNewTurn, stopStreaming, placeholderPromise, getPlaceholderId: () => placeholderId, getAccumulated, updateStatus }
}
