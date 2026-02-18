/**
 * Evolution history storage.
 *
 * Persists evolution records using FileStore to .cah-data/evolution/.
 * Each evolution cycle gets a unique ID and tracks patterns, improvements, and validation.
 */

import { join } from 'path'
import { FileStore } from '../store/GenericFileStore.js'
import { DATA_DIR } from '../store/paths.js'
import { generateShortId } from '../shared/generateId.js'
import { createLogger } from '../shared/logger.js'
import type { EvolutionRecord } from './types.js'

const logger = createLogger('selfevolve')

const EVOLUTION_DIR = join(DATA_DIR, 'evolution')

let store: FileStore<EvolutionRecord> | null = null

function getStore(): FileStore<EvolutionRecord> {
  if (!store) {
    store = new FileStore<EvolutionRecord>({ dir: EVOLUTION_DIR, mode: 'file', ext: '.json' })
  }
  return store
}

/** @internal - for testing only */
export function resetStore(clean = false): void {
  if (clean && store) {
    for (const id of store.listSync()) {
      store.deleteSync(id)
    }
  }
  store = null
}

/** Generate a unique evolution ID */
export function generateEvolutionId(): string {
  return `evo-${generateShortId()}`
}

/** Record a new evolution entry */
export function recordEvolution(record: EvolutionRecord): void {
  getStore().setSync(record.id, record)
  logger.debug(`Recorded evolution: ${record.id}`)
}

/** Get a single evolution record by ID */
export function getEvolution(id: string): EvolutionRecord | null {
  return getStore().getSync(id)
}

/** Update an existing evolution record (partial update) */
export function updateEvolution(id: string, updates: Partial<EvolutionRecord>): void {
  const existing = getStore().getSync(id)
  if (!existing) {
    logger.warn(`Cannot update evolution ${id}: not found`)
    return
  }
  getStore().setSync(id, { ...existing, ...updates })
}

/** List all evolution records, newest first */
export function listEvolutions(): EvolutionRecord[] {
  const ids = getStore().listSync()
  const records: EvolutionRecord[] = []
  for (const id of ids) {
    const record = getStore().getSync(id)
    if (record) records.push(record)
  }
  return records.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  )
}

/** Get the most recent evolution record */
export function getLatestEvolution(): EvolutionRecord | null {
  const records = listEvolutions()
  return records[0] ?? null
}
