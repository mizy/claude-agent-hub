/**
 * Lark message deduplication
 *
 * Prevents processing duplicate messages from:
 * 1. Message ID dedup — standard duplicate detection
 * 2. Content hash dedup — catches WS reconnection replays with different message_ids
 * 3. Stale message filtering — ignores messages created before daemon start
 */

import { createLogger } from '../shared/logger.js'

const logger = createLogger('lark-dedup')

const DEDUP_TTL_MS = 60_000
const CONTENT_DEDUP_TTL_MS = 120_000
const DEDUP_MAX_SIZE = 200
const recentMessageIds = new Map<string, number>()
const recentContentHashes = new Map<string, number>()

export function isDuplicateMessage(messageId: string): boolean {
  if (!messageId) return false
  if (recentMessageIds.has(messageId)) {
    logger.debug(`msgId dedup hit: ${messageId.slice(0, 12)}`)
    return true
  }

  if (recentMessageIds.size >= DEDUP_MAX_SIZE) {
    const now = Date.now()
    for (const [id, ts] of recentMessageIds) {
      if (now - ts > DEDUP_TTL_MS) recentMessageIds.delete(id)
    }
    if (recentMessageIds.size >= DEDUP_MAX_SIZE) {
      const dropCount = Math.floor(DEDUP_MAX_SIZE / 2)
      let i = 0
      for (const id of recentMessageIds.keys()) {
        if (i++ >= dropCount) break
        recentMessageIds.delete(id)
      }
    }
  }

  recentMessageIds.set(messageId, Date.now())
  return false
}

export function isDuplicateContent(chatId: string, content: string): boolean {
  const key = `${chatId}:${simpleHash(content)}`
  const now = Date.now()
  const prev = recentContentHashes.get(key)
  if (prev && now - prev < CONTENT_DEDUP_TTL_MS) {
    logger.debug(`content dedup hit: ${chatId.slice(0, 12)}`)
    return true
  }

  if (recentContentHashes.size >= DEDUP_MAX_SIZE) {
    for (const [k, ts] of recentContentHashes) {
      if (now - ts > CONTENT_DEDUP_TTL_MS) recentContentHashes.delete(k)
    }
  }

  recentContentHashes.set(key, now)
  return false
}

/** FNV-1a 32-bit hash */
function simpleHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h
}

// ── Stale message filtering ──

let daemonStartedAt = Date.now()

export function markDaemonStarted(): void {
  daemonStartedAt = Date.now()
}

export function isStaleMessage(createTime?: string): boolean {
  if (!createTime) return false
  const msgTs = Number(createTime)
  if (Number.isNaN(msgTs)) return false
  return msgTs < daemonStartedAt - 3000
}
