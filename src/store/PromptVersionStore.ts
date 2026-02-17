/**
 * Prompt version store
 *
 * Uses FileStore in file mode, organized by persona subdirectory.
 * Each persona has its own store instance (cached in Map).
 *
 * Storage layout:
 *   .cah-data/prompt-versions/{persona}/{versionId}.json
 */

import { join } from 'path'
import { FileStore } from './GenericFileStore.js'
import { PROMPT_VERSIONS_DIR } from './paths.js'
import { generateShortId } from '../shared/generateId.js'
import type { PromptVersion, PromptVersionStats } from '../types/promptVersion.js'

// Per-persona store cache
const storeCache = new Map<string, FileStore<PromptVersion>>()

function getStoreForPersona(personaName: string): FileStore<PromptVersion> {
  let store = storeCache.get(personaName)
  if (!store) {
    store = new FileStore<PromptVersion>({
      dir: join(PROMPT_VERSIONS_DIR, personaName),
      mode: 'file',
      ext: '.json',
    })
    storeCache.set(personaName, store)
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
  const store = getStoreForPersona(version.personaName)
  store.setSync(version.id, version)
}

/** Get a specific version by persona and version ID */
export function getPromptVersion(personaName: string, versionId: string): PromptVersion | null {
  const store = getStoreForPersona(personaName)
  return store.getSync(versionId)
}

/** Get all versions for a persona, sorted by version number descending */
export function getAllVersions(personaName: string): PromptVersion[] {
  const store = getStoreForPersona(personaName)
  const versions = store.getAllSync()
  return versions.sort((a, b) => b.version - a.version)
}

/** Get the currently active version for a persona */
export function getActiveVersion(personaName: string): PromptVersion | null {
  const versions = getAllVersions(personaName)
  return versions.find(v => v.status === 'active') ?? null
}

/** Get the latest version (highest version number) for a persona */
export function getLatestVersion(personaName: string): PromptVersion | null {
  const versions = getAllVersions(personaName)
  return versions[0] ?? null
}

/** Update stats for a prompt version */
export function updatePromptVersionStats(
  personaName: string,
  versionId: string,
  stats: PromptVersionStats
): boolean {
  const store = getStoreForPersona(personaName)
  return store.updateSync(versionId, { stats })
}

/** Retire a specific version (set status to 'retired') */
export function retireVersion(personaName: string, versionId: string): boolean {
  const store = getStoreForPersona(personaName)
  return store.updateSync(versionId, { status: 'retired' as const })
}

/**
 * Rollback to a target version:
 * - Set target version to 'active'
 * - Set current active version to 'retired'
 * Returns the newly activated version, or null if target not found.
 */
export function rollbackToVersion(
  personaName: string,
  targetVersionId: string
): PromptVersion | null {
  const store = getStoreForPersona(personaName)
  const target = store.getSync(targetVersionId)
  if (!target) return null

  // Retire current active version
  const currentActive = getActiveVersion(personaName)
  if (currentActive && currentActive.id !== targetVersionId) {
    store.updateSync(currentActive.id, { status: 'retired' as const })
  }

  // Activate target
  store.updateSync(targetVersionId, { status: 'active' as const })

  return store.getSync(targetVersionId)
}
