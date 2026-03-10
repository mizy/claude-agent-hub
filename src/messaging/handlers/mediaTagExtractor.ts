/**
 * Extract [SEND_FILE: path] and [SEND_IMAGE: path] tags from AI response text
 * and send them via messenger adapter.
 */

import { existsSync } from 'fs'
import { resolve } from 'path'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { DATA_DIR } from '../../store/paths.js'
import type { MessengerAdapter } from './types.js'

const logger = createLogger('media-tag-extractor')

export interface MediaTag {
  type: 'file' | 'image'
  path: string
}

export interface ExtractResult {
  tags: MediaTag[]
  cleanedText: string
}

/** Matches [SEND_FILE: path] and [SEND_IMAGE: path] tags */
const MEDIA_TAG_RE = /\[SEND_(FILE|IMAGE):\s*(.+?)\]/g

// Allowed directories for media files (DATA_DIR + /tmp). Broader than imageExtractor
// which only allows DATA_DIR, because media tags are explicit user/AI instructions.
const ALLOWED_PREFIXES = [DATA_DIR, resolve('/tmp')]

/** Returns true if path is within allowed directories (DATA_DIR or /tmp) */
function isAllowedPath(filePath: string): boolean {
  const resolved = resolve(filePath)
  return ALLOWED_PREFIXES.some((prefix) => resolved === prefix || resolved.startsWith(prefix + '/'))
}

/** Extract [SEND_FILE: path] and [SEND_IMAGE: path] tags from text */
export function extractMediaTags(text: string): ExtractResult {
  MEDIA_TAG_RE.lastIndex = 0
  const tags: MediaTag[] = []

  let match: RegExpExecArray | null
  while ((match = MEDIA_TAG_RE.exec(text)) !== null) {
    const kind = match[1]!.toLowerCase() as 'file' | 'image'
    const path = match[2]!.trim()
    tags.push({ type: kind, path })
  }

  const cleanedText = text
    .replace(MEDIA_TAG_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { tags, cleanedText }
}

/** Send extracted media tags via messenger adapter */
export async function processMediaTags(
  tags: MediaTag[],
  chatId: string,
  messenger: MessengerAdapter
): Promise<void> {
  for (const tag of tags) {
    try {
      if (!isAllowedPath(tag.path)) {
        logger.warn(`Path not allowed (must be in DATA_DIR or /tmp): ${tag.path}`)
        continue
      }

      if (!existsSync(tag.path)) {
        logger.warn(`Media file not found: ${tag.path}`)
        continue
      }

      if (tag.type === 'file') {
        if (messenger.sendFile) {
          await messenger.sendFile(chatId, tag.path)
          logger.info(`Sent file: ${tag.path}`)
        } else {
          logger.warn(`Adapter does not support sendFile, skipping: ${tag.path}`)
        }
      } else {
        if (messenger.sendImage) {
          await messenger.sendImage(chatId, tag.path)
          logger.info(`Sent image: ${tag.path}`)
        } else {
          logger.warn(`Adapter does not support sendImage, skipping: ${tag.path}`)
        }
      }
    } catch (e) {
      logger.error(`Failed to send ${tag.type} ${tag.path}: ${getErrorMessage(e)}`)
    }
  }
}
