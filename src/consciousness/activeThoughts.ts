/**
 * Active thoughts pool — cross-session state restoration
 *
 * Maintains a pool of active thoughts/ideas that persist across sessions,
 * so CAH knows what it was thinking about last time.
 *
 * Storage: ~/.cah-data/consciousness/active-thoughts.json
 */

import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import { DATA_DIR } from '../store/paths.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('consciousness:thoughts')

const CONSCIOUSNESS_DIR = join(DATA_DIR, 'consciousness')
const THOUGHTS_FILE = join(CONSCIOUSNESS_DIR, 'active-thoughts.json')
const MAX_THOUGHTS = 50

export interface ActiveThought {
  id: string
  thought: string
  priority: 'high' | 'medium' | 'low'
  createdAt: string
  lastReferencedAt: string
  resolvedAt?: string
  source: string
}

function ensureDir(): void {
  mkdirSync(CONSCIOUSNESS_DIR, { recursive: true })
}

function readThoughts(): ActiveThought[] {
  try {
    const raw = readFileSync(THOUGHTS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeThoughts(thoughts: ActiveThought[]): void {
  try {
    ensureDir()
    writeFileSync(THOUGHTS_FILE, JSON.stringify(thoughts, null, 2), 'utf-8')
  } catch (error) {
    logger.warn(`Failed to write active thoughts: ${getErrorMessage(error)}`)
  }
}

/** Load all unresolved thoughts, sorted by priority (high first) then lastReferencedAt (recent first) */
export function loadActiveThoughts(): ActiveThought[] {
  const all = readThoughts()
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  return all
    .filter(t => !t.resolvedAt)
    .sort((a, b) => {
      const pd = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (pd !== 0) return pd
      return new Date(b.lastReferencedAt).getTime() - new Date(a.lastReferencedAt).getTime()
    })
}

/** Add a new active thought */
export function addActiveThought(params: {
  thought: string
  priority?: 'high' | 'medium' | 'low'
  source: string
}): ActiveThought {
  const all = readThoughts()
  const now = new Date().toISOString()
  const entry: ActiveThought = {
    id: randomUUID(),
    thought: params.thought,
    priority: params.priority ?? 'medium',
    createdAt: now,
    lastReferencedAt: now,
    source: params.source,
  }
  all.push(entry)

  // Cleanup: remove resolved + oldest when over limit
  if (all.length > MAX_THOUGHTS) {
    const unresolved = all.filter(t => !t.resolvedAt)
    // Remove all resolved first, then oldest unresolved if still over limit
    if (unresolved.length > MAX_THOUGHTS) {
      unresolved.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      const trimmed = unresolved.slice(unresolved.length - MAX_THOUGHTS)
      writeThoughts(trimmed)
      return entry
    }
    writeThoughts(unresolved)
    return entry
  }

  writeThoughts(all)
  return entry
}

/** Mark a thought as resolved */
export function resolveThought(id: string): boolean {
  const all = readThoughts()
  const thought = all.find(t => t.id === id)
  if (!thought || thought.resolvedAt) return false
  thought.resolvedAt = new Date().toISOString()
  writeThoughts(all)
  return true
}

/** Update lastReferencedAt for a thought */
export function referenceThought(id: string): boolean {
  const all = readThoughts()
  const thought = all.find(t => t.id === id)
  if (!thought) return false
  thought.lastReferencedAt = new Date().toISOString()
  writeThoughts(all)
  return true
}

/** Get top N active (unresolved) thoughts by priority */
export function getTopThoughts(n = 3): ActiveThought[] {
  return loadActiveThoughts().slice(0, n)
}

/** Format active thoughts for prompt injection */
export function formatActiveThoughts(thoughts: ActiveThought[]): string {
  if (thoughts.length === 0) return ''
  const priorityLabel = { high: '高优先级', medium: '中优先级', low: '低优先级' }
  const lines = thoughts.map((t, i) => {
    const label = priorityLabel[t.priority]
    return `${i + 1}. [${label}] ${t.thought}（来源：${t.source}）`
  })
  return `[活跃想法]\n${lines.join('\n')}`
}
