/**
 * HippoRAG-lite entity indexing — extract and index named entities for better retrieval
 *
 * Lightweight entity extraction (regex-based, no LLM needed) that builds an
 * inverted index: entity -> memoryId[]. Used during retrieval to boost memories
 * that share entities with the query, even when keywords differ.
 *
 * Examples of entities: API names (im.v1.image.create), tool names (cliclick),
 * project names (flow360), config keys (CAH_DATA_DIR), error codes, etc.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../store/paths.js'
import { createLogger } from '../shared/logger.js'
import type { MemoryEntry } from './types.js'

const logger = createLogger('entity-index')

// Stored outside MEMORY_DIR to avoid being picked up by MemoryStore's .json scanner
const ENTITY_INDEX_PATH = join(DATA_DIR, 'memory-entity-index.json')

// entity -> memoryId[]
type EntityIndex = Record<string, string[]>

let cachedIndex: EntityIndex | null = null

/** Load entity index from disk (cached in memory) */
function loadIndex(): EntityIndex {
  if (cachedIndex) return cachedIndex
  try {
    const raw = readFileSync(ENTITY_INDEX_PATH, 'utf-8')
    cachedIndex = JSON.parse(raw) as EntityIndex
    return cachedIndex
  } catch {
    cachedIndex = {}
    return cachedIndex
  }
}

/** Persist entity index to disk, update cache only on success */
function saveIndex(index: EntityIndex): void {
  try {
    mkdirSync(join(DATA_DIR, 'memory'), { recursive: true })
    writeFileSync(ENTITY_INDEX_PATH, JSON.stringify(index, null, 2))
    cachedIndex = index
  } catch (e) {
    logger.warn(`Failed to save entity index: ${e}`)
  }
}

/**
 * Extract entities from text using pattern matching.
 * Targets: dotted paths (api.v1.method), UPPER_SNAKE env vars,
 * camelCase/PascalCase identifiers, file paths, CLI commands, etc.
 */
export function extractEntities(text: string): string[] {
  const entities = new Set<string>()

  // Dotted API paths: im.v1.image.create, process.env.CAH_DATA_DIR
  const dottedPaths = text.match(/[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*){2,}/g)
  if (dottedPaths) {
    for (const p of dottedPaths) entities.add(p.toLowerCase())
  }

  // UPPER_SNAKE_CASE (env vars, constants): CAH_DATA_DIR, MAX_RETRIES
  const upperSnake = text.match(/\b[A-Z][A-Z0-9_]{2,}\b/g)
  if (upperSnake) {
    for (const s of upperSnake) entities.add(s.toLowerCase())
  }

  // PascalCase identifiers (class names, types): MemoryEntry, WorkflowExecution
  const pascalCase = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g)
  if (pascalCase) {
    for (const p of pascalCase) entities.add(p.toLowerCase())
  }

  // Backtick-wrapped code entities (common in memory content)
  const backticked = text.match(/`([^`]{2,50})`/g)
  if (backticked) {
    for (const b of backticked) {
      const inner = b.slice(1, -1).trim()
      if (inner.length >= 2 && !inner.includes(' ')) {
        entities.add(inner.toLowerCase())
      }
    }
  }

  // File paths: src/memory/types.ts, ~/.cah-data/tasks
  const filePaths = text.match(/(?:~\/|\.\/|src\/|\/)[a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,5}\b/g)
  if (filePaths) {
    for (const fp of filePaths) entities.add(fp.toLowerCase())
  }

  // CLI commands: cah list, npm install, git push
  const cliCommands = text.match(/\b(?:cah|npm|pnpm|git|gh|curl)\s+[a-z][\w-]*/g)
  if (cliCommands) {
    for (const cmd of cliCommands) entities.add(cmd.toLowerCase())
  }

  return [...entities]
}

/**
 * Index a memory entry's entities. Call after addMemory.
 */
export function indexMemoryEntities(entry: MemoryEntry): string[] {
  const entities = extractEntities(entry.content)
  if (entities.length === 0) return []

  const index = loadIndex()
  for (const entity of entities) {
    if (!index[entity]) index[entity] = []
    if (!index[entity].includes(entry.id)) {
      index[entity].push(entry.id)
    }
  }
  saveIndex(index)
  return entities
}

/**
 * Remove a memory ID from entity index. Call after deleteMemory.
 */
export function removeFromEntityIndex(memoryId: string): void {
  const index = loadIndex()
  let changed = false
  for (const entity of Object.keys(index)) {
    const ids = index[entity]!
    const idx = ids.indexOf(memoryId)
    if (idx !== -1) {
      ids.splice(idx, 1)
      if (ids.length === 0) delete index[entity]
      changed = true
    }
  }
  if (changed) saveIndex(index)
}

/**
 * Query entity index: find memory IDs that share entities with the query text.
 * Returns map of memoryId -> number of matching entities (for scoring).
 */
export function queryEntityIndex(queryText: string): Map<string, number> {
  const queryEntities = extractEntities(queryText)
  if (queryEntities.length === 0) return new Map()

  const index = loadIndex()
  const hits = new Map<string, number>()

  for (const entity of queryEntities) {
    const memoryIds = index[entity]
    if (!memoryIds) continue
    for (const id of memoryIds) {
      hits.set(id, (hits.get(id) ?? 0) + 1)
    }
  }

  return hits
}

/**
 * Rebuild entire entity index from all memories.
 */
export function rebuildEntityIndex(memories: MemoryEntry[]): { totalEntities: number; indexedMemories: number } {
  const index: EntityIndex = {}
  let indexedMemories = 0

  for (const entry of memories) {
    const entities = extractEntities(entry.content)
    if (entities.length === 0) continue
    indexedMemories++
    for (const entity of entities) {
      if (!index[entity]) index[entity] = []
      index[entity].push(entry.id)
    }
  }

  saveIndex(index)
  return { totalEntities: Object.keys(index).length, indexedMemories }
}
