/**
 * Extract local image file paths from AI response text
 * Supports absolute paths, markdown image syntax, and relative paths
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import type { MessengerAdapter } from './types.js'

const logger = createLogger('image-extractor')

// Compiled once at module load — reused across calls (reset lastIndex before each use)
const IMAGE_EXT = '(?:png|jpg|jpeg|gif|webp|bmp)'
const ABSOLUTE_RE = new RegExp(
  `(?:^|\\s|["'\`])(\\/[\\w./-]+\\.${IMAGE_EXT})(?:\\s|$|["'\`\\)\\]},;:])`,
  'gim'
)
const MARKDOWN_RE = new RegExp(
  `!\\[.*?\\]\\(([\\w./-]+\\.${IMAGE_EXT})\\)`,
  'gi'
)
const RELATIVE_RE = new RegExp(
  `(?:^|\\s|["'\`])(\\.?\\/[\\w./-]+\\.${IMAGE_EXT}|[\\w-]+\\.${IMAGE_EXT})(?:\\s|$|["'\`\\)\\]},;:])`,
  'gim'
)

/** Extract local image file paths from text */
export function extractImagePaths(text: string): string[] {
  const paths: string[] = []
  let match: RegExpExecArray | null

  // Pattern 1: Absolute paths (/path/to/image.png)
  ABSOLUTE_RE.lastIndex = 0
  while ((match = ABSOLUTE_RE.exec(text)) !== null) {
    const filePath = match[1]!
    if (existsSync(filePath)) paths.push(filePath)
  }

  // Pattern 2: Markdown image syntax ![alt](path)
  MARKDOWN_RE.lastIndex = 0
  while ((match = MARKDOWN_RE.exec(text)) !== null) {
    const filePath = match[1]!
    const resolved = resolveImagePath(filePath)
    if (resolved && existsSync(resolved)) paths.push(resolved)
  }

  // Pattern 3: Relative paths mentioned in text (./image.png or image.png)
  RELATIVE_RE.lastIndex = 0
  while ((match = RELATIVE_RE.exec(text)) !== null) {
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
      logger.error(`✗ Failed to send image ${imgPath}: ${getErrorMessage(e)}`)
    }
  }
}
