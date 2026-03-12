/**
 * Chat streaming setup — create stream handler and send placeholder message
 */

import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { createStreamHandler, type StreamHandlerOptions } from './streamingHandler.js'
import { createBenchmark } from './chatBenchmark.js'
import type { MessengerAdapter } from './types.js'

const logger = createLogger('chat-stream-setup')

export interface StreamSetup {
  onChunk: ((chunk: string) => void) | undefined
  onToolUse: () => void
  stopStreaming: () => void | Promise<void>
  placeholderPromise: Promise<string | null>
  getPlaceholderId: () => string | null
  getAccumulated: () => string
  updateStatus: (text: string) => void
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
): StreamSetup {
  let placeholderId: string | null = null
  const streamState = { placeholderId: null as string | null }
  const { onChunk, stop: stopStreaming, getAccumulated, resetForNewTurn } = createStreamHandler(
    chatId, streamState, maxLen, messenger, bench, streamOptions
  )
  signal.addEventListener('abort', () => stopStreaming(), { once: true })

  const placeholderText = hasImages ? '🖼️ 已收到图片，分析中...' : hasFiles ? '📎 已收到文件，分析中...' : '🤔 思考中...'
  const placeholderPromise = messenger
    .sendAndGetId(chatId, placeholderText)
    .then(pId => {
      placeholderId = pId
      streamState.placeholderId = pId
      // Flush any content accumulated while placeholder was being sent
      if (onChunk && getAccumulated().length > 0) onChunk('')
      return pId
    })
    .catch(e => { logger.debug(`placeholder send failed: ${getErrorMessage(e)}`); return null })

  // Update the placeholder text with a status message (no-op if placeholder not ready or streaming started)
  function updateStatus(text: string): void {
    if (!placeholderId || getAccumulated().length > 0) return
    messenger.editMessage(chatId, placeholderId, text)
      .catch(e => logger.debug(`status update failed: ${getErrorMessage(e)}`))
  }

  return { onChunk, onToolUse: resetForNewTurn, stopStreaming, placeholderPromise, getPlaceholderId: () => placeholderId, getAccumulated, updateStatus }
}
