/**
 * Shared output size guard for backend stream collection
 *
 * Prevents OOM by tracking byte count and truncating when limit exceeded.
 */

import { createLogger } from '../shared/logger.js'

const logger = createLogger('outputGuard')

// 100MB max output size — same as claudeCodeBackend
export const MAX_OUTPUT_BYTES = 100 * 1024 * 1024

export interface OutputGuard {
  /** Track a new chunk. Returns false if output was truncated (chunk not collected). */
  push(text: string): boolean
  /** Whether the output has been truncated */
  truncated: boolean
  /** Total bytes received so far */
  totalBytes: number
}

export function createOutputGuard(maxBytes = MAX_OUTPUT_BYTES): OutputGuard {
  let totalBytes = 0
  let truncated = false

  return {
    push(text: string): boolean {
      totalBytes += Buffer.byteLength(text)
      if (truncated) return false
      if (totalBytes > maxBytes) {
        truncated = true
        logger.warn(`Output exceeded ${maxBytes / 1024 / 1024}MB limit, truncating collection`)
        return false
      }
      return true
    },
    get truncated() {
      return truncated
    },
    get totalBytes() {
      return totalBytes
    },
  }
}
