/**
 * Prompt version store
 *
 * Uses FileStore in file mode, organized by agent subdirectory and date.
 * Each agent has its own store instance (cached in Map).
 *
 * Storage layout:
 *   .cah-data/prompt-versions/{agent}/{YYYY-MM-DD}/{versionId}.json
 */

import { join } from 'path'
import { readdirSync, existsSync, Dirent } from 'fs'
import { FileStore } from './GenericFileStore.js'
import { PROMPT_VERSIONS_DIR } from './paths.js'
import { generateShortId } from '../shared/generateId.js'
import type { PromptVersion, PromptVersionStats } from '../types/promptVersion.js'

function getDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

// Per-agent-per-date store cache
const storeCache = new Map<string, FileStore<PromptVersion>>()

function getStoreForAgent(
  agentName: string,
  date: string = getDateString()
): FileStore<PromptVersion> {
  const key = `${agentName}:${date}`
  let store = storeCache.get(key)
  if (!store) {
    store = new FileStore<PromptVersion>({
      dir: join(PROMPT_VERSIONS_DIR, agentName, date),
      mode: 'file',
      ext: '.json',
    })
    storeCache.set(key, store)
  }
  return store
}

/** Generate a prompt version ID: pv-{timestamp}-{random} */
export function generateVersionId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `pv-${ts}-${generateShortId()}`
}

/** Save a prompt version */
export function savePromptVersion(version: PromptVersion, date?: string): void {
  const store = getStoreForAgent(version.agentName, date)
  store.setSync(version.id, version)
}

/** Get a specific version by agent and version ID */
export function getPromptVersion(agentName: string, versionId: string): PromptVersion | null {
  const result = getPromptVersionWithDate(agentName, versionId)
  return result?.version ?? null
}

interface VersionWithDate {
  version: PromptVersion
  date: string
}

function getPromptVersionWithDate(agentName: string, versionId: string): VersionWithDate | null {
  const baseDir = join(PROMPT_VERSIONS_DIR, agentName)

  if (!existsSync(baseDir)) return null

  const dateDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter((d: Dirent) => d.isDirectory())
    .map((d: Dirent) => d.name)
    .filter((name: string) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort()
    .reverse()

  for (const date of dateDirs) {
    const store = getStoreForAgent(agentName, date)
    const version = store.getSync(versionId)
    if (version) {
      return { version, date }
    }
  }
  return null
}

/**
 * Get all versions for an agent, sorted by version number descending.
 * Searches across all dates for the agent.
 */
export function getAllVersions(agentName: string): PromptVersion[] {
  const baseDir = join(PROMPT_VERSIONS_DIR, agentName)

  if (!existsSync(baseDir)) return []

  const dateDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter((d: Dirent) => d.isDirectory())
    .map((d: Dirent) => d.name)
    .filter((name: string) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort()
    .reverse()

  const allVersions: PromptVersion[] = []
  for (const date of dateDirs) {
    const store = getStoreForAgent(agentName, date)
    const versions = store.getAllSync()
    allVersions.push(...versions)
  }

  return allVersions.sort((a, b) => b.version - a.version)
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
  const result = getPromptVersionWithDate(agentName, versionId)
  if (!result) return false
  const store = getStoreForAgent(agentName, result.date)
  return store.updateSync(versionId, { stats })
}

/** Retire a specific version (set status to 'retired') */
export function retireVersion(agentName: string, versionId: string): boolean {
  const result = getPromptVersionWithDate(agentName, versionId)
  if (!result) return false
  const store = getStoreForAgent(agentName, result.date)
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
  const result = getPromptVersionWithDate(agentName, targetVersionId)
  if (!result) return null

  const store = getStoreForAgent(agentName, result.date)

  const currentActive = getActiveVersion(agentName)
  if (currentActive && currentActive.id !== targetVersionId) {
    retireVersion(agentName, currentActive.id)
  }

  store.updateSync(targetVersionId, { status: 'active' as const })
  return store.getSync(targetVersionId)
}
