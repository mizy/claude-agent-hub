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
