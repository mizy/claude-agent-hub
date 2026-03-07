/**
 * Prompt version store
 *
 * Uses FileStore in file mode, organized by agent subdirectory.
 * Each agent has its own store instance (cached in Map).
 *
 * Storage layout:
 *   .cah-data/prompt-versions/{agent}/{versionId}.json
 */

import { join } from 'path'
import { FileStore } from './GenericFileStore.js'
import { PROMPT_VERSIONS_DIR } from './paths.js'
import { generateShortId } from '../shared/generateId.js'
import type { PromptVersion, PromptVersionStats } from '../types/promptVersion.js'

// Per-agent store cache
const storeCache = new Map<string, FileStore<PromptVersion>>()

function getStoreForAgent(agentName: string): FileStore<PromptVersion> {
  let store = storeCache.get(agentName)
  if (!store) {
    store = new FileStore<PromptVersion>({
      dir: join(PROMPT_VERSIONS_DIR, agentName),
      mode: 'file',
      ext: '.json',
    })
    storeCache.set(agentName, store)
  }
  return store
}

/** Generate a prompt version ID: pv-{timestamp}-{random} */
export function generateVersionId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `pv-${ts}-${generateShortId()}`
}

/** Save a prompt version */
export function savePromptVersion(version: PromptVersion): void {
  const store = getStoreForAgent(version.agentName)
  store.setSync(version.id, version)
}

/** Get a specific version by agent and version ID */
export function getPromptVersion(agentName: string, versionId: string): PromptVersion | null {
  const store = getStoreForAgent(agentName)
  return store.getSync(versionId)
}

/** Get all versions for an agent, sorted by version number descending */
export function getAllVersions(agentName: string): PromptVersion[] {
  const store = getStoreForAgent(agentName)
  const versions = store.getAllSync()
  return versions.sort((a, b) => b.version - a.version)
}

/** Get the currently active version for an agent */
export function getActiveVersion(agentName: string): PromptVersion | null {
  const versions = getAllVersions(agentName)
  return versions.find(v => v.status === 'active') ?? null
}

/** Get the latest version (highest version number) for an agent */
export function getLatestVersion(agentName: string): PromptVersion | null {
  const versions = getAllVersions(agentName)
  return versions[0] ?? null
}

/** Update stats for a prompt version */
export function updatePromptVersionStats(
  agentName: string,
  versionId: string,
  stats: PromptVersionStats
): boolean {
  const store = getStoreForAgent(agentName)
  return store.updateSync(versionId, { stats })
}

/** Retire a specific version (set status to 'retired') */
export function retireVersion(agentName: string, versionId: string): boolean {
  const store = getStoreForAgent(agentName)
  return store.updateSync(versionId, { status: 'retired' as const })
}

/**
 * Rollback to a target version:
 * - Set target version to 'active'
 * - Set current active version to 'retired'
 * Returns the newly activated version, or null if target not found.
 */
export function rollbackToVersion(
  agentName: string,
  targetVersionId: string
): PromptVersion | null {
  const store = getStoreForAgent(agentName)
  const target = store.getSync(targetVersionId)
  if (!target) return null

  // Retire current active version
  const currentActive = getActiveVersion(agentName)
  if (currentActive && currentActive.id !== targetVersionId) {
    store.updateSync(currentActive.id, { status: 'retired' as const })
  }

  // Activate target
  store.updateSync(targetVersionId, { status: 'active' as const })

  return store.getSync(targetVersionId)
}
