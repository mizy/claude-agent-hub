/**
 * Parse backend override directives from chat messages
 */

import { loadConfig } from '../../config/loadConfig.js'
import { getRegisteredBackends } from '../../backend/resolveBackend.js'

// Cached backend override regex (invalidated when backend list changes)
let cachedBackendPattern: RegExp | null = null
let cachedBackendList: string | null = null

/** Parse backend override from message text (e.g. "@iflow question" or "/use opencode\nquestion") */
export async function parseBackendOverride(
  text: string
): Promise<{ backend?: string; actualText: string }> {
  const registeredBackends = getRegisteredBackends()

  // Also include named backends from config (e.g. "local" -> type:"claude-code")
  const config = await loadConfig()
  const namedBackends = Object.keys(config.backends || {})

  const allBackends = [...new Set([...registeredBackends, ...namedBackends])]
  const backendListKey = allBackends.join(',')

  // Reuse cached regex if backend list hasn't changed
  if (backendListKey !== cachedBackendList) {
    cachedBackendPattern = new RegExp(
      `^[@/](?:backend:|use\\s+)?(${allBackends.join('|')})(?:\\s|\\n)`,
      's'
    )
    cachedBackendList = backendListKey
  }

  const match = text.match(cachedBackendPattern!)
  if (!match) return { actualText: text }

  const backend = match[1]
  const actualText = text.slice(match[0].length).trim()
  return { backend, actualText }
}
