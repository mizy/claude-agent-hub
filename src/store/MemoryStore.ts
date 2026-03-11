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

export function getAllMemories(): MemoryEntry[] {
  return memoryStore.getAllSync()
}

export function getMemory(id: string): MemoryEntry | null {
  return memoryStore.getSync(id)
}

export function saveMemory(entry: MemoryEntry): void {
  memoryStore.setSync(entry.id, entry)
}

export function deleteMemory(id: string): boolean {
  return memoryStore.deleteSync(id)
}

export function updateMemory(id: string, updates: Partial<MemoryEntry>): boolean {
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
  return memoryStore.updateSync(id, updates)
}
