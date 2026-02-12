/**
 * Extract local image file paths from AI response text
 * Supports absolute paths, markdown image syntax, and relative paths
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'
import { createLogger } from '../../shared/logger.js'
import type { MessengerAdapter } from './types.js'

const logger = createLogger('image-extractor')

/** Extract local image file paths from text */
export function extractImagePaths(text: string): string[] {
  const paths: string[] = []

  // Pattern 1: Absolute paths (/path/to/image.png)
  const absoluteRegex =
    /(?:^|\s|["'`])(\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp))(?:\s|$|["'`)\]},;:])/gim
  let match: RegExpExecArray | null
  while ((match = absoluteRegex.exec(text)) !== null) {
    const filePath = match[1]!
    if (existsSync(filePath)) paths.push(filePath)
  }

  // Pattern 2: Markdown image syntax ![alt](path)
  const markdownRegex = /!\[.*?\]\(([\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp))\)/gi
  while ((match = markdownRegex.exec(text)) !== null) {
    const filePath = match[1]!
    const resolved = resolveImagePath(filePath)
    if (resolved && existsSync(resolved)) paths.push(resolved)
  }

  // Pattern 3: Relative paths mentioned in text (./image.png or image.png)
  const relativeRegex =
    /(?:^|\s|["'`])(\.?\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp)|[\w-]+\.(?:png|jpg|jpeg|gif|webp|bmp))(?:\s|$|["'`)\]},;:])/gim
  while ((match = relativeRegex.exec(text)) !== null) {
    const filePath = match[1]!
    const resolved = resolveImagePath(filePath)
    if (resolved && existsSync(resolved)) paths.push(resolved)
  }

  return [...new Set(paths)] // dedupe
}

/** Resolve relative path to absolute, trying cwd and common temp dirs */
export function resolveImagePath(filePath: string): string | null {
  if (isAbsolute(filePath)) return filePath

  // Try cwd
  const cwdPath = resolve(process.cwd(), filePath)
  if (existsSync(cwdPath)) return cwdPath

  // Try common temp directories
  const tempDirs = ['/tmp', '/var/tmp', process.env.TMPDIR || ''].filter(Boolean)
  for (const dir of tempDirs) {
    const fullPath = resolve(dir, filePath)
    if (existsSync(fullPath)) return fullPath
  }

  return null
}

/** Detect image paths in response text and send them via messenger */
export async function sendDetectedImages(
  chatId: string,
  response: string,
  messenger: MessengerAdapter
): Promise<void> {
  if (!messenger.replyImage) return

  const imagePaths = extractImagePaths(response)
  if (imagePaths.length > 0) {
    logger.info(`Detected ${imagePaths.length} image(s) in response`)
  }
  for (const imgPath of imagePaths) {
    try {
      logger.info(`Reading image: ${imgPath}`)
      const imageData = readFileSync(imgPath)
      logger.info(`Sending image (${imageData.length} bytes) to ${chatId.slice(0, 8)}`)
      await messenger.replyImage(chatId, imageData, imgPath)
      logger.info(`✓ Image sent: ${imgPath}`)
    } catch (e) {
      logger.error(`✗ Failed to send image ${imgPath}: ${e instanceof Error ? e.message : e}`)
    }
  }
}
