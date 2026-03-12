/**
 * Strip <think>...</think> tags from reasoning model outputs (DeepSeek, minimax, etc.)
 */

/** Remove all <think>...</think> blocks from text (for final response) */
export function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
    .trimStart()
}

