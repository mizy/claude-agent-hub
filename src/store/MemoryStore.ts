/**
 * Memory file store
 *
 * Uses FileStore in file mode: each memory entry is a JSON file in MEMORY_DIR.
 */

import { FileStore } from './GenericFileStore.js'
import { MEMORY_DIR } from './paths.js'
import type { MemoryEntry } from '../memory/types.js'

const memoryStore = new FileStore<MemoryEntry>({
  dir: MEMORY_DIR,
  mode: 'file',
  ext: '.json',
})

const MEMORY_CACHE_TTL_MS = 30_000
let memoryCached: MemoryEntry[] | null = null
let memoryCacheTs = 0

function invalidateMemoryCache(): void {
  memoryCached = null
}

export function getAllMemories(): MemoryEntry[] {
  const now = Date.now()
  if (memoryCached !== null && now - memoryCacheTs < MEMORY_CACHE_TTL_MS) {
    return memoryCached
  }
  memoryCached = memoryStore.getAllSync()
  memoryCacheTs = now
  return memoryCached
}

export function getMemory(id: string): MemoryEntry | null {
  return memoryStore.getSync(id)
}

export function saveMemory(entry: MemoryEntry): void {
  invalidateMemoryCache()
  memoryStore.setSync(entry.id, entry)
}

export function deleteMemory(id: string): boolean {
  invalidateMemoryCache()
  return memoryStore.deleteSync(id)
}

export function updateMemory(id: string, updates: Partial<MemoryEntry>): boolean {
  invalidateMemoryCache()
  return memoryStore.updateSync(id, updates)
}

/**
 * Read-modify-write: reads current state, applies updater fn, writes back.
 * Prevents lost updates from stale closures (e.g. accessCount += 1 after await).
 * Safe in Node.js single-threaded model: entire call is synchronous, so no
 * interleaving between read and write within the same event loop tick.
 */
export function atomicUpdateMemory(id: string, updater: (current: MemoryEntry) => Partial<MemoryEntry>): boolean {
  const current = memoryStore.getSync(id)
  if (current === null) return false
  const updates = updater(current)
  invalidateMemoryCache()
  return memoryStore.updateSync(id, updates)
}
