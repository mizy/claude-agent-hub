/**
 * MemScene — domain-based user model snapshots
 *
 * Pure algorithm, 0 LLM calls.
 * Classifies messages by domain keywords, aggregates related memory IDs,
 * and generates summary strings for prompt injection.
 */

import { loadConfig } from '../config/loadConfig.js'
import { getMemScene, saveMemScene } from '../store/MemSceneStore.js'
import { getMemory } from '../store/MemoryStore.js'
import type { MemScene } from './types.js'

/**
 * Classify text into a domain using keyword dictionary from config.
 * Returns the domain with the most keyword hits, or null if no match.
 */
export async function classifyDomain(text: string): Promise<string | null> {
  const config = await loadConfig()
  const domains = config.memory.memScene.domains
  const lower = text.toLowerCase()

  let bestDomain: string | null = null
  let bestCount = 0

  for (const [domain, keywords] of Object.entries(domains)) {
    let count = 0
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        count++
      }
    }
    if (count > bestCount) {
      bestCount = count
      bestDomain = domain
    }
  }

  return bestDomain
}

/**
 * Update a MemScene by merging new IDs (deduped) and regenerating summary.
 */
export function updateMemScene(
  domain: string,
  options: { factIds?: string[]; memoryIds?: string[]; episodeIds?: string[] },
): MemScene {
  const existing = getMemScene(domain)

  const factIds = dedupe([...(existing?.factIds ?? []), ...(options.factIds ?? [])])
  const memoryIds = dedupe([...(existing?.memoryIds ?? []), ...(options.memoryIds ?? [])])
  const episodeIds = dedupe([...(existing?.episodeIds ?? []), ...(options.episodeIds ?? [])])

  const parts: string[] = []
  if (factIds.length > 0) parts.push(`${factIds.length}条事实`)
  if (memoryIds.length > 0) parts.push(`${memoryIds.length}条记忆`)
  if (episodeIds.length > 0) parts.push(`${episodeIds.length}段对话`)
  const summary = parts.length > 0 ? `[${domain}] ${parts.join('、')}` : `[${domain}] 空`

  const scene: MemScene = {
    domain,
    summary,
    factIds,
    memoryIds,
    episodeIds,
    updatedAt: new Date().toISOString(),
  }

  saveMemScene(scene)
  return scene
}

/**
 * Build a ~200 char user profile summary from a MemScene's linked memories.
 */
export function buildMemSceneSummary(scene: MemScene): string {
  const snippets: string[] = []
  let totalLen = 0
  const BUDGET = 200

  // Pull content from linked semantic memories (most informative)
  for (const mid of scene.memoryIds) {
    if (totalLen >= BUDGET) break
    const mem = getMemory(mid)
    if (!mem) continue
    const snippet = mem.content.length > 60 ? mem.content.slice(0, 57) + '...' : mem.content
    snippets.push(snippet)
    totalLen += snippet.length
  }

  if (snippets.length === 0) {
    return scene.summary
  }

  const header = `[${scene.domain}]`
  return `${header} ${snippets.join('；')}`.slice(0, BUDGET)
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)]
}
