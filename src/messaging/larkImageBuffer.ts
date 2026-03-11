/**
 * Lark image/file download and pending image buffer
 *
 * Handles: image download with size guard, file download with sanitization,
 * pending image buffering (waits for text message to arrive before flushing)
 */

import { statSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../store/paths.js'
import type * as Lark from '@larksuiteoapi/node-sdk'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('lark-image')

// ── File / image limits ──

const IMAGE_BUFFER_DELAY_MS = 10_000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_FILE_BYTES = 50 * 1024 * 1024

interface PendingImage {
  chatId: string
  images: string[]
  isGroup: boolean
  hasMention: boolean
  timer: ReturnType<typeof setTimeout>
}

const pendingImageBuffer = new Map<string, PendingImage>()

// ── Downloads ──

export async function downloadLarkImage(
  larkClient: Lark.Client,
  messageId: string,
  imageKey: string
): Promise<string | null> {
  try {
    const res = await larkClient.im.v1.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: 'image' },
    })
    const fileData = res as unknown as { writeFile(path: string): Promise<void> }
    if (typeof fileData?.writeFile !== 'function') {
      logger.error(
        `Unexpected messageResource response: ${JSON.stringify(res).slice(0, 200)}`
      )
      return null
    }
    const tmpDir = join(DATA_DIR, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const filePath = join(tmpDir, `lark-img-${Date.now()}-${imageKey.slice(-8)}.png`)
    await fileData.writeFile(filePath)

    const fileSize = statSync(filePath).size
    if (fileSize > MAX_IMAGE_BYTES) {
      logger.warn(
        `Image too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB > ${MAX_IMAGE_BYTES / 1024 / 1024}MB`
      )
      try { unlinkSync(filePath) } catch (e) { logger.debug(`Failed to clean up tmp file ${filePath}: ${getErrorMessage(e)}`) }
      return null
    }

    logger.debug(
      `Downloaded image: ${imageKey} → ${filePath} (${(fileSize / 1024).toFixed(0)}KB)`
    )
    return filePath
  } catch (error) {
    logger.error(`Failed to download image ${imageKey}: ${getErrorMessage(error)}`)
    return null
  }
}

export async function downloadLarkFile(
  larkClient: Lark.Client,
  messageId: string,
  fileKey: string,
  fileName: string
): Promise<string | null> {
  try {
    const res = await larkClient.im.v1.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type: 'file' },
    })
    const fileData = res as unknown as { writeFile(path: string): Promise<void> }
    if (typeof fileData?.writeFile !== 'function') {
      logger.error(`Unexpected file response for key ${fileKey}`)
      return null
    }
    const tmpDir = join(DATA_DIR, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unnamed'
    const filePath = join(tmpDir, `lark-file-${Date.now()}-${safeName}`)
    await fileData.writeFile(filePath)

    const fileSize = statSync(filePath).size
    if (fileSize > MAX_FILE_BYTES) {
      logger.warn(`File too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB > ${MAX_FILE_BYTES / 1024 / 1024}MB`)
      try { unlinkSync(filePath) } catch (e) { logger.debug(`Failed to clean up tmp file ${filePath}: ${getErrorMessage(e)}`) }
      return null
    }

    logger.debug(`Downloaded file: ${fileName} → ${filePath} (${(fileSize / 1024).toFixed(0)}KB)`)
    return filePath
  } catch (error) {
    logger.error(`Failed to download file ${fileName}: ${getErrorMessage(error)}`)
    return null
  }
}

// ── Pending image buffer ──

export function hasPendingImages(chatId: string): boolean {
  return pendingImageBuffer.has(chatId)
}

export function bufferImage(
  chatId: string,
  imagePath: string,
  isGroup: boolean,
  hasMention: boolean,
  onFlush: (chatId: string, text: string, isGroup: boolean, hasMention: boolean, images?: string[]) => Promise<void>
): void {
  const existing = pendingImageBuffer.get(chatId)
  if (existing) {
    clearTimeout(existing.timer)
    existing.images.push(imagePath)
    existing.timer = setTimeout(() => {
      flushPendingImages(chatId, '', onFlush).catch(e => {
        logger.error(`Failed to flush pending images on timeout: ${getErrorMessage(e)}`)
      })
    }, IMAGE_BUFFER_DELAY_MS)
  } else {
    const timer = setTimeout(() => {
      flushPendingImages(chatId, '', onFlush).catch(e => {
        logger.error(`Failed to flush pending images on timeout: ${getErrorMessage(e)}`)
      })
    }, IMAGE_BUFFER_DELAY_MS)
    pendingImageBuffer.set(chatId, {
      chatId,
      images: [imagePath],
      isGroup,
      hasMention,
      timer,
    })
  }
  logger.debug(
    `Image buffered for chat ${chatId}, waiting ${IMAGE_BUFFER_DELAY_MS}ms for text`
  )
}

export async function flushPendingImages(
  chatId: string,
  text: string,
  handleMessage: (
    chatId: string,
    text: string,
    isGroup: boolean,
    hasMention: boolean,
    images?: string[],
    files?: string[]
  ) => Promise<void>
): Promise<void> {
  const pending = pendingImageBuffer.get(chatId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingImageBuffer.delete(chatId)
  try {
    await handleMessage(chatId, text, pending.isGroup, pending.hasMention, pending.images)
  } catch (error) {
    logger.error(
      `Failed to handle message with images for chat ${chatId}: ${getErrorMessage(error)}`
    )
  } finally {
    // Clean up downloaded tmp files after consumption
    for (const imgPath of pending.images) {
      try { unlinkSync(imgPath) } catch { /* already removed */ }
    }
  }
}
