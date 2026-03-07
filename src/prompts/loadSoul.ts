/**
 * Load SOUL.md — user-customizable agent for chat
 *
 * Reads DATA_DIR/SOUL.md if it exists, returns its content.
 * Falls back to null if file doesn't exist or can't be read.
 */

import { join } from 'path'
import { readFileSync, statSync } from 'fs'
import { DATA_DIR } from '../store/paths.js'
import { logger } from '../shared/logger.js'

const SOUL_FILE = join(DATA_DIR, 'SOUL.md')
const CACHE_TTL_MS = 5000

let cached: { content: string | null; mtime: number; checkedAt: number } | null = null

/**
 * Load SOUL.md content with mtime + TTL cache.
 * Returns null if file doesn't exist or is empty.
 */
export function loadSoul(): string | null {
  const now = Date.now()
  if (cached && now - cached.checkedAt < CACHE_TTL_MS) return cached.content

  try {
    const mtime = statSync(SOUL_FILE).mtimeMs
    if (cached && cached.mtime === mtime) {
      cached.checkedAt = now
      return cached.content
    }

    const content = readFileSync(SOUL_FILE, 'utf-8').trim() || null
    cached = { content, mtime, checkedAt: now }
    return content
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
      logger.warn(`Failed to read SOUL.md: ${String(err)}`)
    }
    cached = { content: null, mtime: 0, checkedAt: now }
    return null
  }
}
