/**
 * Episodic memory injection — format episodes for prompt context
 * and detect when episode retrieval should be triggered.
 */

import type { Episode } from './types.js'

// Trigger words that indicate user is referring to past conversations
const EPISODE_TRIGGER_PATTERNS = [
  /上次/,
  /那次/,
  /还记得/,
  /之前讨论/,
  /之前聊/,
  /之前说/,
  /继续/,
  /接上/,
  /我们说的/,
  /我们聊的/,
  /上回/,
  /昨天/,
  /前天/,
  /上周/,
  /\d+\s*天前/,
  /周[一二三四五六日]/,
  /earlier/i,
  /last time/i,
  /remember when/i,
  /we discussed/i,
  /we talked about/i,
  /continue from/i,
  /pick up where/i,
  /yesterday/i,
  /last week/i,
]

/** Check if a message likely references a past conversation episode */
export function shouldRetrieveEpisode(message: string): boolean {
  return EPISODE_TRIGGER_PATTERNS.some(p => p.test(message))
}

/** Format a single episode timestamp to readable date string */
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Format retrieved episodes as context for prompt injection */
export function formatEpisodeContext(episodes: Episode[]): string {
  if (episodes.length === 0) return ''

  const sections = episodes.map(ep => {
    const lines: string[] = []
    lines.push(`[情景回忆: ${formatTimestamp(ep.timestamp)}]`)
    lines.push(`对话摘要: ${ep.summary}`)

    if (ep.keyDecisions.length > 0) {
      lines.push(`关键决策: ${ep.keyDecisions.join('; ')}`)
    }

    return lines.join('\n')
  })

  return `## 情景记忆\n\n${sections.join('\n\n')}`
}
