/**
 * Atomic Fact Store — CRUD for atomic facts using GenericFileStore
 *
 * Each fact is stored as a separate .json file in ATOMIC_FACTS_DIR.
 */

import { FileStore } from './GenericFileStore.js'
import { ATOMIC_FACTS_DIR } from './paths.js'
import type { AtomicFact } from '../memory/types.js'

const store = new FileStore<AtomicFact>({
  dir: ATOMIC_FACTS_DIR,
  mode: 'file',
})

export function saveAtomicFact(fact: AtomicFact): void {
  store.setSync(fact.id, fact)
}

export function getAtomicFact(id: string): AtomicFact | null {
  return store.getSync(id)
}

export function deleteAtomicFact(id: string): boolean {
  return store.deleteSync(id)
}

export function getAllAtomicFacts(): AtomicFact[] {
  return store.getAllSync()
}

export function queryAtomicFacts(
  filter: Partial<AtomicFact> | ((fact: AtomicFact) => boolean),
): AtomicFact[] {
  const all = getAllAtomicFacts()
  if (typeof filter === 'function') {
    return all.filter(filter)
  }
  return all.filter(fact => {
    for (const [key, value] of Object.entries(filter)) {
      if ((fact as unknown as Record<string, unknown>)[key] !== value) return false
    }
    return true
  })
}
