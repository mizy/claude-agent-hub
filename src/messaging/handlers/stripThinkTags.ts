/**
 * Strip <think>...</think> tags from reasoning model outputs (DeepSeek, minimax, etc.)
 */

import { createLogger } from '../../shared/logger.js'

const logger = createLogger('strip-think-tags')

/** Remove entire <think>...</think> blocks from output, logging content at debug level */
export function stripThinkTags(text: string): string {
  return text
    .replace(/<think>([\s\S]*?)<\/think>/g, (_match, content: string) => {
      const trimmed = content.trim()
      if (trimmed) {
        logger.debug(`stripped think block (${trimmed.length} chars): ${trimmed.slice(0, 200)}`)
      }
      return '\n'
    })
    .replace(/<\/?think>/g, '\n') // catch any orphaned tags
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
